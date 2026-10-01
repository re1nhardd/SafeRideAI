import time
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
import server


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("SAFERIDE_HARDWARE", "0")
    monkeypatch.setattr(server, "S", server.State())
    with TestClient(server.app) as client:
        yield client


def test_health_does_not_claim_safe_without_camera(client):
    data = client.get("/health").json()
    assert data["hardware_enabled"] is False
    assert data["camera_ready"] is False
    assert data["face_detected"] is False
    assert data["attention"] == 0


def test_missing_snapshot_is_unavailable(client):
    assert client.get("/snapshot").status_code == 503


def test_fresh_snapshot_is_uncached(client):
    server.S.frame = b"jpeg-fixture"
    server.S.frame_time = time.monotonic()
    response = client.get("/snapshot")
    assert response.content == b"jpeg-fixture"
    assert response.headers["cache-control"] == "no-store"


def test_stale_camera_is_not_reported_as_live(client):
    server.S.frame = b"old-frame"
    server.S.frame_time = time.monotonic() - 10
    server.S.update(camera_ready=True, face_detected=True, attention=99)
    assert client.get("/snapshot").status_code == 503
    status = client.get("/health").json()
    assert status["camera_ready"] is False
    assert status["attention"] == 0


def test_websocket_status_and_disconnect_cleanup(client):
    with client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "status"
        assert len(server.S.clients) == 1
    assert len(server.S.clients) == 0


def test_websocket_rejects_unlisted_browser_origin(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            "/ws", headers={"origin": "https://untrusted.example"}
        ):
            pass


def test_alert_and_status_share_working_event_loop(client):
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        server.S.frame_time = time.monotonic()
        server.S.update(
            camera_ready=True,
            detector_ready=True,
            face_detected=True,
            calibrated=True,
            alert="DROWSY",
        )
        assert ws.receive_json()["type"] == "status"
        message = ws.receive_json()
        assert message["type"] == "alert"
        assert message["alert"] == "DROWSY"
        assert ws.receive_json()["type"] == "status"


def test_cooldowns_are_per_kind_and_allow_first_alert():
    state = server.State()
    assert state.alert_due("DROWSY", now=1)
    assert not state.alert_due("DROWSY", now=2)
    assert state.alert_due("HELP", now=2)
    assert state.alert_due("DROWSY", now=31)


def test_dashboard_loads_without_hardware(client):
    response = client.get("/dashboard")
    assert response.status_code == 200
    assert "SafeRide AI" in response.text


def test_speech_keywords_and_logging_default_off(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("SAFERIDE_SPEECH_LOG", raising=False)
    from src.audio_v2 import SpeechRecognizer, AudioConfig

    recognizer = SpeechRecognizer(
        help_words=["help", "помогите"], config=AudioConfig(backend="none")
    )
    recognizer._handle_text("Please help me", False)
    assert recognizer.help_detected
    recognizer._handle_text("помогите мне", False)
    assert recognizer.help_detected
    recognizer._handle_text("Good morning", False)
    assert not recognizer.help_detected
    assert not list(tmp_path.iterdir())


def test_google_listener_stops(monkeypatch):
    from src.audio_v2 import SpeechRecognizer, AudioConfig

    recognizer = SpeechRecognizer(config=AudioConfig(backend="none"))
    calls = []
    recognizer._stop_listening = lambda **kwargs: calls.append(kwargs)
    recognizer.stop()
    assert calls == [{"wait_for_stop": False}]


def test_speech_alerts_expire_instead_of_repeating_forever():
    from types import SimpleNamespace

    speech = SimpleNamespace(
        last_transcript_at=100,
        help_detected=True,
        offensive_detected=False,
        speech_text="help",
    )
    assert server.speech_snapshot(speech, now=105)["help_detected"]
    assert not server.speech_snapshot(speech, now=111)["help_detected"]
