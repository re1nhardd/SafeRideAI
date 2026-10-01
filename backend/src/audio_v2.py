"""Optional speech recognition and keyword matching for SafeRide AI.

Supports Whisper or Google, optional VAD, fuzzy/phonetic keyword matching,
and an experimental energy/zero-crossing distress cue. Accuracy is unmeasured.
No speech log is written unless SAFERIDE_SPEECH_LOG is explicitly configured.
"""

from __future__ import annotations

import os
import re
import time
import queue
import threading
import difflib
import requests
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional

import numpy as np

# ----- Optional deps -----------------------------------------------------------
try:
    import speech_recognition as sr

    HAS_SR = True
except Exception:
    sr = None
    HAS_SR = False

try:
    from faster_whisper import WhisperModel

    HAS_WHISPER = True
except Exception:
    HAS_WHISPER = False

try:
    import webrtcvad

    HAS_VAD = True
except Exception:
    HAS_VAD = False

try:
    import pyaudio

    HAS_PYAUDIO = True
except Exception:
    HAS_PYAUDIO = False


# =============================================================================
# Phonetic matching (Metaphone)
# =============================================================================
def _metaphone(word: str) -> str:
    """Lightweight Metaphone implementation for English-ish words."""
    if not word:
        return ""
    word = word.lower().strip()
    word = re.sub(r"[^a-z]", "", word)
    if not word:
        return ""

    # Start trims
    for prefix in ("ae", "gn", "kn", "pn", "wr"):
        if word.startswith(prefix):
            word = word[1:]
            break
    if word.startswith("x"):
        word = "s" + word[1:]
    if word.startswith("wh"):
        word = "w" + word[2:]

    out = []
    i, n = 0, len(word)
    while i < n:
        c = word[i]
        prev = word[i - 1] if i > 0 else ""
        nxt = word[i + 1] if i + 1 < n else ""

        # Skip duplicate consonants except 'c'
        if c == prev and c != "c":
            i += 1
            continue

        if c in "aeiou":
            if i == 0:
                out.append(c)
        elif c == "b":
            if not (i == n - 1 and prev == "m"):
                out.append("b")
        elif c == "c":
            if nxt == "h":
                out.append("x")
                i += 1
            elif nxt in "iey":
                out.append("s")
            else:
                out.append("k")
        elif c == "d":
            if nxt == "g" and i + 2 < n and word[i + 2] in "iey":
                out.append("j")
                i += 2
            else:
                out.append("t")
        elif c in "fjlmnr":
            out.append(c)
        elif c == "g":
            if nxt == "h":
                if i + 2 >= n or word[i + 2] not in "aeiou":
                    i += 1
                else:
                    out.append("f")
                    i += 1
            elif nxt == "n":
                pass
            elif nxt in "iey":
                out.append("j")
            else:
                out.append("k")
        elif c == "h":
            if i > 0 and prev in "aeiou" and (nxt not in "aeiou"):
                pass
            else:
                out.append("h")
        elif c == "k":
            if prev != "c":
                out.append("k")
        elif c == "p":
            if nxt == "h":
                out.append("f")
                i += 1
            else:
                out.append("p")
        elif c == "q":
            out.append("k")
        elif c == "s":
            if nxt == "h":
                out.append("x")
                i += 1
            else:
                out.append("s")
        elif c == "t":
            if nxt == "h":
                out.append("0")
                i += 1
            else:
                out.append("t")
        elif c == "v":
            out.append("f")
        elif c == "w":
            if nxt in "aeiou":
                out.append("w")
        elif c == "x":
            out.append("ks")
        elif c == "y":
            if nxt in "aeiou":
                out.append("y")
        elif c == "z":
            out.append("s")
        i += 1
    return "".join(out)


def phonetic_distance(a: str, b: str) -> float:
    """0..1 similarity between metaphone codes."""
    ma, mb = _metaphone(a), _metaphone(b)
    if not ma or not mb:
        return 0.0
    return difflib.SequenceMatcher(None, ma, mb).ratio()


# =============================================================================
# Config
# =============================================================================
@dataclass
class AudioConfig:
    backend: str = "auto"  # "whisper" | "google" | "auto"
    whisper_model: str = "base"  # tiny | base | small | medium
    whisper_device: str = "cpu"  # "cpu" | "cuda"
    whisper_compute: str = "int8"  # "int8", "float16" on GPU
    language: Optional[str] = None  # e.g. "en", or None for auto-detect

    # Buffering
    sample_rate: int = 16000
    chunk_ms: int = 30  # VAD frame size (10/20/30 ms)
    max_utterance_sec: float = 6.0
    silence_end_sec: float = 0.7  # silence to end utterance

    # Matching
    fuzzy_threshold: float = 0.78
    phonetic_threshold: float = 0.85

    # Alerts
    alert_cooldown: float = 60.0

    # Distress audio cue
    distress_rms_db: float = -18.0  # spike threshold
    distress_pitch_hz: float = 280.0


# =============================================================================
# Speech recognizer
# =============================================================================
class SpeechRecognizer:
    """
    Drop-in compatible with v1 SpeechRecognizer.

    Backend selection:
      - "auto" (default): whisper if installed, else google
      - "whisper": faster-whisper (offline)
      - "google":  speech_recognition + Google online API
    """

    # ---- Public attributes (read by GUI) -------------------------------------
    speech_text: str = ""
    partial_text: str = ""
    offensive_detected: bool = False
    help_detected: bool = False

    def __init__(
        self,
        offensive_words: Optional[List[str]] = None,
        help_words: Optional[List[str]] = None,
        webhook_url: Optional[str] = None,
        config: Optional[AudioConfig] = None,
        # legacy kwargs for backward compat
        phrase_time_limit: float = 3,
        silence_flush_sec: float = 0.8,
        fuzzy_threshold: float = 0.78,
        alert_cooldown: float = 60.0,
    ):
        self.cfg = config or AudioConfig(
            silence_end_sec=silence_flush_sec,
            max_utterance_sec=phrase_time_limit * 2,
            fuzzy_threshold=fuzzy_threshold,
            alert_cooldown=alert_cooldown,
        )
        self.offensive_words = [
            w.lower().strip() for w in (offensive_words or []) if w.strip()
        ]
        self.help_words = [w.lower().strip() for w in (help_words or []) if w.strip()]
        self.webhook_url = webhook_url

        # Pre-compute regex + metaphone for keywords
        self._off_regex = [
            re.compile(r"\b" + re.escape(w) + r"\b", re.I) for w in self.offensive_words
        ]
        self._help_regex = [
            re.compile(r"\b" + re.escape(w) + r"\b", re.I) for w in self.help_words
        ]
        self._off_phono = [_metaphone(w) for w in self.offensive_words]
        self._help_phono = [_metaphone(w) for w in self.help_words]

        # Backend selection
        self.backend = self._pick_backend()
        self._whisper = None
        if self.backend == "whisper":
            self._whisper = WhisperModel(
                self.cfg.whisper_model,
                device=self.cfg.whisper_device,
                compute_type=self.cfg.whisper_compute,
            )

        # Listening state
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._audio_q: "queue.Queue[bytes]" = queue.Queue()
        self._last_alert: dict = {"offensive": 0.0, "help": 0.0}

        # VAD
        self._vad = webrtcvad.Vad(2) if HAS_VAD else None

        # Logging
        self.log_file = os.getenv("SAFERIDE_SPEECH_LOG", "")
        self._init_log()

    # ----- Backend ------------------------------------------------------------
    def _pick_backend(self) -> str:
        choice = self.cfg.backend
        if choice == "auto":
            if HAS_WHISPER and HAS_PYAUDIO:
                return "whisper"
            if HAS_SR:
                return "google"
            return "none"
        return choice

    def _init_log(self):
        if self.log_file and not os.path.exists(self.log_file):
            with open(self.log_file, "w") as f:
                f.write("Timestamp,Type,Detected,Sentence\n")

    # ----- Lifecycle ----------------------------------------------------------
    def start(self):
        if self.backend == "whisper":
            self._start_whisper()
        elif self.backend == "google":
            self._start_google()
        else:
            print(
                "[Audio] No backend available. Install faster-whisper or SpeechRecognition."
            )

    def stop(self):
        self._running = False
        if getattr(self, "_stop_listening", None):
            self._stop_listening(wait_for_stop=False)
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)

    # ----- Whisper backend ----------------------------------------------------
    def _start_whisper(self):
        if not HAS_PYAUDIO:
            print("[Audio] pyaudio not available; cannot capture mic.")
            return
        self._running = True
        self._thread = threading.Thread(target=self._whisper_loop, daemon=True)
        self._thread.start()

    def _whisper_loop(self):
        sr_ = self.cfg.sample_rate
        frame_size = int(sr_ * self.cfg.chunk_ms / 1000)
        pa = pyaudio.PyAudio()
        stream = pa.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=sr_,
            input=True,
            frames_per_buffer=frame_size,
        )

        utterance: List[bytes] = []
        silence_run = 0.0
        speaking = False
        utt_start = 0.0

        try:
            while self._running:
                buf = stream.read(frame_size, exception_on_overflow=False)
                is_speech = self._is_speech(buf, sr_)
                now = time.time()
                if speaking and now - utt_start >= self.cfg.max_utterance_sec:
                    self._process_utterance(b"".join(utterance), sr_)
                    utterance = []
                    silence_run = 0.0
                    speaking = False

                if is_speech:
                    if not speaking:
                        utt_start = now
                        speaking = True
                    utterance.append(buf)
                    silence_run = 0.0
                else:
                    if speaking:
                        utterance.append(buf)
                        silence_run += self.cfg.chunk_ms / 1000.0
                        if (
                            silence_run >= self.cfg.silence_end_sec
                            or now - utt_start >= self.cfg.max_utterance_sec
                        ):
                            self._process_utterance(b"".join(utterance), sr_)
                            utterance = []
                            silence_run = 0.0
                            speaking = False
        finally:
            stream.stop_stream()
            stream.close()
            pa.terminate()

    def _is_speech(self, buf: bytes, sr_: int) -> bool:
        if self._vad:
            try:
                return self._vad.is_speech(buf, sr_)
            except Exception:
                return True
        # Fallback: simple RMS gate
        a = np.frombuffer(buf, dtype=np.int16).astype(np.float32) / 32768.0
        rms = np.sqrt(np.mean(a * a) + 1e-12)
        return rms > 0.01

    def _process_utterance(self, audio_bytes: bytes, sr_: int):
        if not audio_bytes:
            return
        audio = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        if len(audio) < sr_ * 0.3:  # too short
            return
        try:
            segments, _info = self._whisper.transcribe(
                audio,
                language=self.cfg.language,
                vad_filter=False,
                beam_size=1,
            )
            text = " ".join(s.text.strip() for s in segments).strip()
        except Exception as e:
            print(f"[Whisper] error: {e}")
            return
        if not text:
            return

        # Distress audio cue
        distress_cue = self._detect_distress(audio, sr_)

        self._handle_text(text, distress_cue)

    def _detect_distress(self, audio: np.ndarray, sr_: int) -> bool:
        # RMS dB
        rms = np.sqrt(np.mean(audio**2) + 1e-12)
        rms_db = 20 * np.log10(rms + 1e-12)
        if rms_db < self.cfg.distress_rms_db:
            return False
        # Crude pitch via zero-crossing rate -> rough Hz estimate
        zc = np.sum(np.abs(np.diff(np.sign(audio)))) / 2.0
        duration = len(audio) / sr_
        approx_pitch = zc / duration if duration > 0 else 0.0
        return approx_pitch > self.cfg.distress_pitch_hz

    # ----- Google fallback backend -------------------------------------------
    def _start_google(self):
        self.r = sr.Recognizer()
        self.mic = sr.Microphone()
        try:
            with self.mic as src:
                self.r.adjust_for_ambient_noise(src, duration=1)
        except Exception:
            pass
        self._stop_listening = self.r.listen_in_background(
            self.mic, self._google_callback, phrase_time_limit=3
        )

    def _google_callback(self, recognizer, audio):
        try:
            text = recognizer.recognize_google(
                audio, language=self.cfg.language or "en-US"
            )
        except Exception:
            return
        self._handle_text(text, distress_cue=False)

    # ----- Text processing ---------------------------------------------------
    def _handle_text(self, text: str, distress_cue: bool):
        text = text.strip()
        if not text:
            return
        self.last_transcript_at = time.monotonic()
        self.partial_text = text
        self.speech_text = text

        offensive = self._match_keywords(
            text, self.offensive_words, self._off_regex, self._off_phono
        )
        helpwise = self._match_keywords(
            text, self.help_words, self._help_regex, self._help_phono
        )

        # Distress audio cue can also trigger help alert
        if distress_cue and not helpwise:
            helpwise = True
            text = text + "  [distress audio cue]"

        if offensive and not self.offensive_detected:
            self._alert("offensive", text)
            self._log("offensive", text)
        if helpwise and not self.help_detected:
            self._alert("help", text)
            self._log("help", text)

        self.offensive_detected = offensive
        self.help_detected = helpwise

    def _match_keywords(
        self,
        sentence: str,
        words: List[str],
        regexes: List[re.Pattern],
        phonos: List[str],
    ) -> bool:
        if not words:
            return False
        # Exact / regex
        for rx in regexes:
            if rx.search(sentence):
                return True
        # Token-level
        tokens = re.findall(r"\w+", sentence.lower())
        for w in words:
            if " " in w and w in sentence.lower():
                return True
            if w in tokens:
                return True
        # Fuzzy
        s_lower = sentence.lower()
        for w in words:
            if (
                difflib.SequenceMatcher(None, w, s_lower).ratio()
                >= self.cfg.fuzzy_threshold
            ):
                return True
        # Phonetic per-token
        token_phonos = [_metaphone(t) for t in tokens]
        for kw_phono in phonos:
            if not kw_phono:
                continue
            for tp in token_phonos:
                if not tp:
                    continue
                if (
                    difflib.SequenceMatcher(None, kw_phono, tp).ratio()
                    >= self.cfg.phonetic_threshold
                ):
                    return True
        return False

    # ----- Alerts + logs -----------------------------------------------------
    def _alert(self, kind: str, sentence: str):
        now = time.time()
        if now - self._last_alert.get(kind, 0) < self.cfg.alert_cooldown:
            return
        self._last_alert[kind] = now
        if not self.webhook_url:
            return
        try:
            requests.post(
                self.webhook_url,
                timeout=3,
                json={"event": kind, "text": sentence, "timestamp": now},
            )
        except Exception:
            pass

    def _log(self, kind: str, sentence: str):
        if not self.log_file:
            return
        try:
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            with open(self.log_file, "a", encoding="utf-8") as f:
                f.write(f'{ts},{kind},,"{sentence}"\n')
        except Exception:
            pass


# Quick smoke test
if __name__ == "__main__":
    rec = SpeechRecognizer(
        offensive_words=["idiot", "stupid"],
        help_words=["help", "stop the car", "police"],
    )
    print("Backend:", rec.backend)
    rec.start()
    try:
        while True:
            time.sleep(1)
            if rec.speech_text:
                print(
                    f"[{rec.speech_text}] off={rec.offensive_detected} help={rec.help_detected}"
                )
    except KeyboardInterrupt:
        rec.stop()
