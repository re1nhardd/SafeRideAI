"""SafeRide AI: local camera inference with a WebSocket/HTTP transport.

Run from backend/: python server.py. The Vercel deployment hosts only the client.
"""

from __future__ import annotations
import asyncio
from contextlib import asynccontextmanager
import logging
import os
from pathlib import Path
import threading
import time

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse

LOG = logging.getLogger("saferide")
BASE = Path(__file__).resolve().parent
COOLDOWNS = {
    "DROWSY": 30,
    "WARNING": 15,
    "SLEEPY": 20,
    "LOW_ATTENTION": 25,
    "OFFENSIVE": 60,
    "HELP": 10,
}
MESSAGES = {
    "DROWSY": ("Drowsiness detected. Pull over safely and take a break.", "critical"),
    "WARNING": ("Eyes closing. Stay alert.", "warning"),
    "SLEEPY": ("Yawning detected. Consider a break.", "warning"),
    "LOW_ATTENTION": ("Phone detected. Keep your attention on the road.", "warning"),
    "OFFENSIVE": ("Potentially concerning speech detected.", "warning"),
    "HELP": ("Help phrase detected. Check the situation.", "critical"),
}
HELP_PHRASES = [
    "help",
    "police",
    "stop the car",
    "emergency",
    "need help",
    "помогите",
    "помощь",
    "остановите",
    "полиция",
]
OFFENSIVE_WORDS = ["kill", "shoot", "attack", "убью"]


class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.frame = b""
        self.frame_time = 0.0
        self.clients: set[WebSocket] = set()
        self.last_alert: dict[str, float] = {}
        self.speech = None
        self.worker = None
        self.status = dict(
            attention=0.0,
            alert="NONE",
            yawning=False,
            speech_text="",
            offensive_detected=False,
            help_detected=False,
            camera_ready=False,
            detector_ready=False,
            calibrated=False,
            face_detected=False,
            phone_detected=False,
            looking_away=False,
            error="",
        )

    def snapshot(self):
        with self.lock:
            data = self.status.copy()
            if data["camera_ready"] and time.monotonic() - self.frame_time > 5:
                data.update(
                    camera_ready=False,
                    face_detected=False,
                    attention=0.0,
                    error="Camera frames are stale. Check the server.",
                )
            return data

    def update(self, **values):
        with self.lock:
            self.status.update(values)

    def alert_due(self, kind, now=None):
        now = time.monotonic() if now is None else now
        if now - self.last_alert.get(kind, float("-inf")) < COOLDOWNS.get(kind, 30):
            return False
        self.last_alert[kind] = now
        return True


S = State()


def speech_snapshot(speech, now=None):
    now = time.monotonic() if now is None else now
    fresh = now - getattr(speech, "last_transcript_at", float("-inf")) <= 10
    return dict(
        speech_text=getattr(speech, "speech_text", ""),
        offensive_detected=fresh and bool(getattr(speech, "offensive_detected", False)),
        help_detected=fresh and bool(getattr(speech, "help_detected", False)),
    )


def inference_worker():
    """Only this thread owns the camera and ML models; no async socket writes."""
    cap = None
    detector = None
    try:
        import cv2
        from src import detection_v2 as detector

        detector.reset_state(
            detector.DetectionConfig(
                calibration_seconds=5,
                ema_alpha=0.30,
                phone_conf_threshold=0.25,
                yawn_consec_frames=10,
                pose_consec_frames=10,
            )
        )
        S.update(detector_ready=True)
        if os.getenv("SAFERIDE_AUDIO", "off") != "off":
            try:
                from src.audio_v2 import SpeechRecognizer, AudioConfig

                S.speech = SpeechRecognizer(
                    offensive_words=OFFENSIVE_WORDS,
                    help_words=HELP_PHRASES,
                    config=AudioConfig(
                        backend=os.getenv("SAFERIDE_AUDIO", "auto"),
                        language=os.getenv("SAFERIDE_LANGUAGE", "en-US"),
                    ),
                )
                S.speech.start()
            except Exception:
                LOG.exception("Audio unavailable; continuing with vision only")
                S.speech = None
        cap = cv2.VideoCapture(int(os.getenv("SAFERIDE_CAMERA", "0")))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if not cap.isOpened():
            raise RuntimeError(
                "No camera found. Check SAFERIDE_CAMERA and camera permissions."
            )
        interval = 1 / max(1, min(30, float(os.getenv("SAFERIDE_FPS", "5"))))
        while not S.stop.is_set():
            start = time.monotonic()
            ok, frame = cap.read()
            if not ok:
                S.update(
                    camera_ready=False,
                    face_detected=False,
                    error="Camera frame unavailable.",
                )
                S.stop.wait(0.5)
                continue
            processed, score, alert, yawning = detector.detect_attention_and_drowsiness(
                frame
            )
            ok, encoded = cv2.imencode(
                ".jpg", processed, [cv2.IMWRITE_JPEG_QUALITY, 80]
            )
            if not ok:
                continue
            info = detector.get_observations()
            speech = S.speech
            with S.lock:
                S.frame = encoded.tobytes()
                S.frame_time = time.monotonic()
                S.status.update(
                    attention=round(score, 1),
                    alert=alert,
                    yawning=bool(yawning),
                    camera_ready=True,
                    calibrated=detector.is_calibrated(),
                    error="",
                    **info,
                    **speech_snapshot(speech),
                )
            S.stop.wait(max(0, interval - (time.monotonic() - start)))
    except Exception as error:
        LOG.exception("Inference unavailable")
        S.update(
            camera_ready=False,
            detector_ready=False,
            face_detected=False,
            error=str(error),
        )
    finally:
        if cap is not None:
            cap.release()
        if S.speech is not None:
            S.speech.stop()
        if detector is not None:
            detector.close_models()


async def broadcast():
    """One event loop sends status + alerts, including per-kind cooldowns."""
    while True:
        data = S.snapshot()
        payloads = [{"type": "status", "data": data}]
        kinds = (
            [data["alert"]]
            if data["camera_ready"] and data["face_detected"] and data["calibrated"]
            else []
        )
        if data["offensive_detected"]:
            kinds.append("OFFENSIVE")
        if data["help_detected"]:
            kinds.append("HELP")
        for kind in kinds:
            if kind in MESSAGES and S.alert_due(kind):
                message, severity = MESSAGES[kind]
                payloads.append(
                    dict(
                        type="alert",
                        alert=kind,
                        message=message,
                        severity=severity,
                        time=time.time(),
                    )
                )

        async def send(client):
            try:
                for payload in payloads:
                    await asyncio.wait_for(client.send_json(payload), timeout=2)
            except Exception:
                S.clients.discard(client)
                try:
                    await client.close()
                except Exception:
                    pass

        await asyncio.gather(*(send(client) for client in list(S.clients)))
        await asyncio.sleep(0.5)


@asynccontextmanager
async def lifespan(app):
    S.stop.clear()
    if os.getenv("SAFERIDE_HARDWARE", "1") != "0":
        S.worker = threading.Thread(
            target=inference_worker, name="saferide-inference", daemon=True
        )
        S.worker.start()
    task = asyncio.create_task(broadcast())
    try:
        yield
    finally:
        S.stop.set()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        for client in list(S.clients):
            await client.close()
        S.clients.clear()
        if S.worker:
            await asyncio.to_thread(S.worker.join, 5)


app = FastAPI(title="SafeRide AI", version="1.1.0", lifespan=lifespan)
ALLOWED_ORIGINS = [
    v.strip()
    for v in os.getenv(
        "SAFERIDE_ALLOWED_ORIGINS",
        "http://localhost:8081,http://127.0.0.1:8081,http://localhost:8000,http://127.0.0.1:8000",
    ).split(",")
    if v.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET"],
    allow_headers=[],
)


@app.get("/")
@app.get("/health")
def health():
    return dict(
        service="SafeRide AI",
        clients=len(S.clients),
        hardware_enabled=os.getenv("SAFERIDE_HARDWARE", "1") != "0",
        **S.snapshot(),
    )


@app.get("/snapshot")
def snapshot():
    with S.lock:
        frame, stamp = S.frame, S.frame_time
    if not frame or time.monotonic() - stamp > 5:
        raise HTTPException(503, "No recent camera frame available")
    return Response(
        frame, media_type="image/jpeg", headers={"Cache-Control": "no-store"}
    )


@app.get("/stream")
async def stream():
    async def frames():
        while not S.stop.is_set():
            with S.lock:
                frame, stamp = S.frame, S.frame_time
            if frame and time.monotonic() - stamp <= 5:
                yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
            await asyncio.sleep(0.2)

    return StreamingResponse(
        frames(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/dashboard")
def dashboard():
    return FileResponse(BASE / "dashboard.html")


@app.websocket("/ws")
async def socket(ws: WebSocket):
    origin = ws.headers.get("origin")
    own_origins = {
        f"http://{ws.headers.get('host')}",
        f"https://{ws.headers.get('host')}",
    }
    if origin and origin not in ALLOWED_ORIGINS and origin not in own_origins:
        await ws.close(code=1008)
        return
    await ws.accept()
    S.clients.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        S.clients.discard(ws)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.getenv("SAFERIDE_HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
    )
