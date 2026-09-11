import json
import dashboard_access as access
from dashboard_history import RETENTION_SECONDS, collect, history, save_sample


def test_history_discards_personal_fields_and_expires_samples(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path)
    save_sample({"cpu_percent": 20, "ip": "192.0.2.1", "username": "private", "url": "private"}, now=100)
    save_sample({"memory_percent": 40, "session_count": None}, now=RETENTION_SECONDS + 101)
    result = history(now=RETENTION_SECONDS + 101)
    assert len(result["data"]["items"]) == 1
    assert result["data"]["items"][0]["session_count"] is None
    assert "private" not in json.dumps(result)


def test_unavailable_sources_are_not_recorded_as_zero(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path)
    collect(lambda service, path: (502, b'{"error":"unavailable"}', "application/json"))
    item = history()["data"]["items"][0]
    assert all(value is None for key, value in item.items() if key != "observed_at")


def test_invalid_metrics_are_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr(access, "PRIVATE", tmp_path)
    save_sample({"cpu_percent": float("nan"), "session_count": "personal-data", "memory_percent": True})
    item = history()["data"]["items"][0]
    assert all(value is None for key, value in item.items() if key != "observed_at")
