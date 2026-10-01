"""Opt-in model smoke tests: SAFERIDE_TEST_MODELS=1 python -m pytest."""

import os
from types import SimpleNamespace
import pytest
import numpy as np

pytestmark = pytest.mark.skipif(
    os.getenv("SAFERIDE_TEST_MODELS") != "1",
    reason="Requires downloaded inference models",
)


def test_mouth_aspect_ratio_and_zero_width():
    from src import detection_v2 as d

    points = [SimpleNamespace(x=0.0, y=0.0) for _ in range(478)]
    points[13] = SimpleNamespace(x=0.5, y=0.4)
    points[14] = SimpleNamespace(x=0.5, y=0.6)
    points[78] = SimpleNamespace(x=0.3, y=0.5)
    points[308] = SimpleNamespace(x=0.7, y=0.5)
    assert d._mar(points) == pytest.approx(0.5)
    points[308] = points[78]
    assert d._mar(points) == 0


def test_blank_frame_resets_stale_yawn_and_face_state():
    from src import detection_v2 as d

    d.reset_state()
    d._state.yawning = True
    d._state.looking_away = True
    frame, score, alert, yawning = d.detect_attention_and_drowsiness(
        np.zeros((480, 640, 3), dtype=np.uint8)
    )
    assert frame.shape == (480, 640, 3)
    assert 0 <= score <= 100
    assert not yawning
    assert not d.get_observations()["face_detected"]
    assert not d.get_observations()["looking_away"]


def test_perclos_expires_old_samples():
    from src import detection_v2 as d

    d.reset_state()
    d._state.eye_closed_log.extend([(1, True), (99, False), (100, True)])
    assert d._compute_perclos(100, 30) == 0.5
    assert d._compute_perclos(140, 30) == 0
