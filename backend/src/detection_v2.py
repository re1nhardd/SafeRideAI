# -*- coding: utf-8 -*-
"""
SafeRide AI - Detection v2
Uses new MediaPipe Tasks API (works with mediapipe 0.10.30+)
Public API: detect_attention_and_drowsiness(frame, speech_recognizer=None)
Returns: (frame, smooth_attention, alert, yawning)
"""

import os
import time
import urllib.request
from pathlib import Path
from collections import deque
from dataclasses import dataclass, field
from typing import Optional, Tuple

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
from ultralytics import YOLO

# =============================================================================
# Download face landmark model if not present
# =============================================================================

MODEL_DIR = Path(__file__).resolve().parents[1] / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)
MODEL_PATH = str(MODEL_DIR / "face_landmarker.task")


def _ensure_model():
    if not os.path.exists(MODEL_PATH):
        print("[MediaPipe] Downloading face_landmarker.task (~30MB)...")
        url = (
            "https://storage.googleapis.com/mediapipe-models/"
            "face_landmarker/face_landmarker/float16/1/face_landmarker.task"
        )
        temporary = MODEL_PATH + ".download"
        with (
            urllib.request.urlopen(url, timeout=60) as response,
            open(temporary, "wb") as output,
        ):
            import shutil

            shutil.copyfileobj(response, output)
        os.replace(temporary, MODEL_PATH)
        print("[MediaPipe] Model downloaded successfully!")


_ensure_model()

# =============================================================================
# Configuration
# =============================================================================


@dataclass
class DetectionConfig:
    width: int = 640
    height: int = 480

    # PERCLOS
    perclos_window_sec: float = 30.0
    perclos_warn: float = 0.15
    perclos_drowsy: float = 0.30

    # Yawn
    yawn_consec_frames: int = 25
    yawn_recovery: int = 3

    # Calibration
    calibration_seconds: float = 5.0
    ear_factor: float = 0.78
    mar_factor: float = 1.55
    fallback_ear: float = 0.23
    fallback_mar: float = 0.70

    # Head pose
    yaw_threshold_deg: float = 22.0
    pitch_threshold_deg: float = 18.0
    pose_consec_frames: int = 10

    # Attention smoothing
    ema_alpha: float = 0.25

    # Phone detection
    phone_conf_threshold: float = 0.30
    phone_min_size: int = 40
    phone_max_size: int = 360


# =============================================================================
# MediaPipe Face Landmarker (new Tasks API)
# =============================================================================

_base_options = mp_python.BaseOptions(model_asset_path=MODEL_PATH)
_face_options = mp_vision.FaceLandmarkerOptions(
    base_options=_base_options,
    num_faces=1,
    min_face_detection_confidence=0.5,
    min_face_presence_confidence=0.5,
    min_tracking_confidence=0.5,
)
face_landmarker = mp_vision.FaceLandmarker.create_from_options(_face_options)

# =============================================================================
# YOLO for phone detection
# =============================================================================

_model_path = os.getenv("SAFERIDE_YOLO_MODEL", str(MODEL_DIR / "yolov8n.pt"))
yolo = YOLO(_model_path)
yolo.overrides["verbose"] = False
yolo.overrides["imgsz"] = 416

DISTRACTION_CLASSES = {"cell phone", "book", "laptop"}

# =============================================================================
# Landmark indices (MediaPipe 478-point model)
# =============================================================================

LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]
MOUTH = [
    61,
    78,
    95,
    88,
    178,
    87,
    14,
    317,
    402,
    318,
    324,
    308,
    415,
    310,
    311,
    312,
    13,
    82,
    81,
    80,
    191,
]

# 3D model points for head pose
MODEL_POINTS_3D = np.array(
    [
        (0.0, 0.0, 0.0),
        (0.0, -63.6, -12.5),
        (-43.3, 32.7, -26.0),
        (43.3, 32.7, -26.0),
        (-28.9, -28.9, -24.1),
        (28.9, -28.9, -24.1),
    ],
    dtype=np.float64,
)
POSE_LANDMARKS = [1, 152, 33, 263, 61, 291]

# =============================================================================
# Geometry helpers
# =============================================================================


def _ear(landmarks, idx):
    p = [np.array([landmarks[i].x, landmarks[i].y]) for i in idx]
    A = np.linalg.norm(p[1] - p[5])
    B = np.linalg.norm(p[2] - p[4])
    C = np.linalg.norm(p[0] - p[3])
    return (A + B) / (2.0 * C) if C > 0 else 0.0


def _mar(landmarks, idx=None):
    """Inner lip opening / mouth width, in normalized face coordinates."""
    upper = np.array([landmarks[13].x, landmarks[13].y])
    lower = np.array([landmarks[14].x, landmarks[14].y])
    left = np.array([landmarks[78].x, landmarks[78].y])
    right = np.array([landmarks[308].x, landmarks[308].y])
    width = np.linalg.norm(right - left)
    return float(np.linalg.norm(lower - upper) / width) if width > 0 else 0.0


def _head_pose(landmarks, frame_w, frame_h):
    try:
        image_pts = np.array(
            [
                [landmarks[i].x * frame_w, landmarks[i].y * frame_h]
                for i in POSE_LANDMARKS
            ],
            dtype=np.float64,
        )

        focal = frame_w
        cam = np.array(
            [
                [focal, 0, frame_w / 2],
                [0, focal, frame_h / 2],
                [0, 0, 1],
            ],
            dtype=np.float64,
        )

        ok, rvec, _ = cv2.solvePnP(
            MODEL_POINTS_3D,
            image_pts,
            cam,
            np.zeros((4, 1)),
            flags=cv2.SOLVEPNP_ITERATIVE,
        )
        if not ok:
            return 0.0, 0.0, 0.0

        rmat, _ = cv2.Rodrigues(rvec)
        pitch, yaw, roll = cv2.RQDecomp3x3(rmat)[0]
        return yaw, pitch, roll
    except Exception:
        return 0.0, 0.0, 0.0


# =============================================================================
# State
# =============================================================================


@dataclass
class DetectionState:
    cfg: DetectionConfig = field(default_factory=DetectionConfig)

    # Calibration
    calibrated: bool = False
    calib_start: float = 0.0
    calib_ear_samples: list = field(default_factory=list)
    calib_mar_samples: list = field(default_factory=list)
    ear_threshold: float = 0.0
    mar_threshold: float = 0.0

    # PERCLOS
    eye_closed_log: deque = field(default_factory=lambda: deque(maxlen=900))

    # Yawn
    mar_counter: int = 0
    yawning: bool = False

    # Head pose
    pose_away_counter: int = 0
    looking_away: bool = False

    # Smoothed attention
    ema_attention: float = 100.0

    # Phone
    phone_seen_t: float = 0.0
    hand_on_phone: bool = False
    face_detected: bool = False


_state = DetectionState()


# =============================================================================
# Public helpers
# =============================================================================


def reset_state(cfg: Optional[DetectionConfig] = None):
    global _state
    _state = DetectionState(cfg=cfg or DetectionConfig())


def is_calibrated() -> bool:
    return _state.calibrated


def get_thresholds() -> Tuple[float, float]:
    return _state.ear_threshold, _state.mar_threshold


# =============================================================================
# Main detection function
# =============================================================================


def detect_attention_and_drowsiness(frame, speech_recognizer=None):
    """
    Process one video frame.
    Returns: (annotated_frame, smooth_attention, alert_label, yawning)
    """
    cfg = _state.cfg
    frame = cv2.flip(frame, 1)
    frame = cv2.resize(frame, (cfg.width, cfg.height))
    h, w, _ = frame.shape

    # Convert to RGB for MediaPipe
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    # ── Face landmarks ────────────────────────────────────────────────────────
    face_result = face_landmarker.detect(mp_image)
    face_detected = len(face_result.face_landmarks) > 0
    _state.face_detected = face_detected
    if not face_detected:
        _state.yawning = False
        _state.mar_counter = 0
        _state.looking_away = False
        _state.pose_away_counter = 0
    eyes_open = True
    EAR = 0.0
    MAR = 0.0
    landmarks = None

    if face_detected:
        landmarks = face_result.face_landmarks[0]

        EAR = (_ear(landmarks, LEFT_EYE) + _ear(landmarks, RIGHT_EYE)) / 2.0
        MAR = _mar(landmarks, MOUTH)

        # Calibration phase
        if not _state.calibrated:
            _run_calibration(EAR, MAR)
        else:
            eyes_open = EAR > _state.ear_threshold

        # Head pose
        yaw, pitch, _ = _head_pose(landmarks, w, h)
        away = abs(yaw) > cfg.yaw_threshold_deg or abs(pitch) > cfg.pitch_threshold_deg
        if away:
            _state.pose_away_counter = min(
                _state.pose_away_counter + 1, cfg.pose_consec_frames + 5
            )
        else:
            _state.pose_away_counter = max(0, _state.pose_away_counter - 1)
        _state.looking_away = _state.pose_away_counter >= cfg.pose_consec_frames

        # Yawn
        mar_thresh = _state.mar_threshold if _state.calibrated else cfg.fallback_mar
        if eyes_open and MAR > mar_thresh:
            _state.mar_counter += 1
        else:
            _state.mar_counter = max(0, _state.mar_counter - cfg.yawn_recovery)
        _state.yawning = _state.mar_counter >= cfg.yawn_consec_frames

        # Draw landmarks on frame
        _draw_landmarks(frame, landmarks, w, h)

    # ── PERCLOS ───────────────────────────────────────────────────────────────
    now = time.time()
    if face_detected and _state.calibrated:
        _state.eye_closed_log.append((now, not eyes_open))

    perclos = _compute_perclos(now, cfg.perclos_window_sec)
    drowsy = perclos >= cfg.perclos_drowsy
    drowsy_warn = cfg.perclos_warn <= perclos < cfg.perclos_drowsy

    # ── YOLO object detection ─────────────────────────────────────────────────
    yolo_results = yolo(frame, stream=False, verbose=False)
    distractions = []
    object_bboxes = {}
    phone_now = False

    for r in yolo_results:
        for box in r.boxes:
            cls = yolo.names[int(box.cls)]
            conf = float(box.conf[0])
            if cls not in DISTRACTION_CLASSES:
                continue
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            bw, bh = x2 - x1, y2 - y1

            if cls == "cell phone":
                if not (
                    cfg.phone_min_size <= bw <= cfg.phone_max_size
                    and cfg.phone_min_size <= bh <= cfg.phone_max_size
                ):
                    continue
                if conf < cfg.phone_conf_threshold:
                    continue
                phone_now = True
                _state.phone_seen_t = now
            elif conf < 0.4:
                continue

            distractions.append(cls)
            object_bboxes[cls] = (x1, y1, x2, y2)

    phone_detected = phone_now or (now - _state.phone_seen_t < 1.5)

    _state.hand_on_phone = phone_detected

    # ── Attention score ───────────────────────────────────────────────────────
    score = 100.0
    if not face_detected:
        score -= 30
    if face_detected and _state.looking_away:
        score -= 25
    if drowsy:
        score -= 50
    elif drowsy_warn:
        score -= 25
    if _state.yawning:
        score -= 20
    if phone_detected:
        score -= 25
    if "laptop" in distractions:
        score -= 20
    if "book" in distractions:
        score -= 15
    score = max(0.0, min(100.0, score))

    # EMA smoothing
    a = cfg.ema_alpha
    _state.ema_attention = a * score + (1 - a) * _state.ema_attention
    smooth = _state.ema_attention

    # ── On-screen text ────────────────────────────────────────────────────────
    color = (
        (60, 220, 120)
        if smooth > 70
        else (40, 200, 255)
        if smooth > 40
        else (60, 90, 255)
    )
    cv2.putText(
        frame,
        f"Attention {smooth:5.1f}%",
        (10, 28),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        color,
        2,
    )

    if not _state.calibrated:
        remaining = max(0, cfg.calibration_seconds - (now - _state.calib_start))
        cv2.putText(
            frame,
            f"Calibrating... {remaining:.1f}s",
            (10, 60),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (0, 220, 255),
            2,
        )
    else:
        cv2.putText(
            frame,
            f"PERCLOS {perclos * 100:4.1f}%",
            (10, 60),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (200, 200, 200),
            1,
        )

    y = 90
    if drowsy:
        cv2.putText(
            frame,
            "DROWSINESS ALERT",
            (10, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (60, 90, 255),
            2,
        )
        y += 28
    elif drowsy_warn:
        cv2.putText(
            frame,
            "EYES CLOSING",
            (10, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (40, 165, 255),
            2,
        )
        y += 28
    if _state.yawning:
        cv2.putText(
            frame, "YAWNING", (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 0), 2
        )
        y += 28
    if phone_detected:
        cv2.putText(
            frame,
            "PHONE DETECTED",
            (10, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (40, 165, 255),
            2,
        )

    # Draw bounding boxes
    for name, (x1, y1, x2, y2) in object_bboxes.items():
        col = (60, 90, 255) if name == "cell phone" else (0, 200, 220)
        cv2.rectangle(frame, (x1, y1), (x2, y2), col, 2)
        cv2.putText(frame, name, (x1, y1 - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.5, col, 1)

    # ── Alert label ───────────────────────────────────────────────────────────
    if drowsy:
        alert = "DROWSY"
    elif drowsy_warn:
        alert = "WARNING"
    elif _state.yawning:
        alert = "SLEEPY"
    elif phone_detected:
        alert = "LOW_ATTENTION"
    else:
        alert = "NONE"

    return frame, smooth, alert, _state.yawning


# =============================================================================
# Calibration
# =============================================================================


def _run_calibration(ear, mar):
    cfg = _state.cfg
    if _state.calib_start == 0:
        _state.calib_start = time.time()

    _state.calib_ear_samples.append(ear)
    _state.calib_mar_samples.append(mar)

    if time.time() - _state.calib_start >= cfg.calibration_seconds:
        if len(_state.calib_ear_samples) > 10:
            _state.ear_threshold = (
                float(np.median(_state.calib_ear_samples)) * cfg.ear_factor
            )
            _state.mar_threshold = (
                float(np.median(_state.calib_mar_samples)) * cfg.mar_factor
            )
            _state.mar_threshold = max(_state.mar_threshold, 0.35)
        else:
            _state.ear_threshold = cfg.fallback_ear
            _state.mar_threshold = cfg.fallback_mar
        _state.calibrated = True
        print(
            f"[Calibration] Done! EAR={_state.ear_threshold:.3f}  "
            f"MAR={_state.mar_threshold:.3f}"
        )


def _compute_perclos(now: float, window_sec: float) -> float:
    log = _state.eye_closed_log
    while log and now - log[0][0] > window_sec:
        log.popleft()
    if not log:
        return 0.0
    closed = sum(1 for _, c in log if c)
    return closed / len(log)


# =============================================================================
# Draw face mesh dots
# =============================================================================


def _draw_landmarks(frame, landmarks, w, h):
    try:
        for lm in landmarks:
            x = int(lm.x * w)
            y = int(lm.y * h)
            cv2.circle(frame, (x, y), 1, (0, 200, 100), -1)
    except Exception:
        pass


def get_observations():
    return dict(
        face_detected=_state.face_detected,
        phone_detected=_state.hand_on_phone,
        looking_away=_state.looking_away,
    )


def close_models():
    face_landmarker.close()
