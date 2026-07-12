"""Tests for api/health.py."""
import sys
import os
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


class TestHealthEndpoint:
    def test_returns_200(self):
        response = client.get("/api/health")
        assert response.status_code == 200

    def test_status_ok(self):
        response = client.get("/api/health")
        data = response.json()
        assert data["status"] == "ok"

    def test_required_fields_present(self):
        response = client.get("/api/health")
        data = response.json()
        for field in ("status", "ffmpeg", "vpn", "vpn_auto", "cache_entries", "uptime_seconds", "python"):
            assert field in data, f"Missing field: {field}"

    def test_uptime_is_non_negative(self):
        response = client.get("/api/health")
        assert response.json()["uptime_seconds"] >= 0

    def test_cache_entries_is_int(self):
        response = client.get("/api/health")
        assert isinstance(response.json()["cache_entries"], int)

    def test_python_version_format(self):
        response = client.get("/api/health")
        version = response.json()["python"]
        parts = version.split(".")
        assert len(parts) >= 2
        assert all(p.isdigit() for p in parts[:2])

    def test_vpn_off_when_no_wireproxy(self):
        with patch("services.vpn._wireproxy_process", None):
            response = client.get("/api/health")
        assert response.json()["vpn"] == "off"

    def test_ffmpeg_field_is_string(self):
        response = client.get("/api/health")
        assert isinstance(response.json()["ffmpeg"], str)
