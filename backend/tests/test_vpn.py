"""Tests for VPN failover logic — especially record_youtube_error() in container mode."""
import asyncio
import sys
import os
import pytest
from unittest.mock import patch, MagicMock, AsyncMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services import vpn as vpn_svc
from services.vpn import record_youtube_error, reset_youtube_errors, is_wireproxy_active


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _reset_state():
    vpn_svc._vpn_auto_mode = False
    vpn_svc._vpn_error_count = 0
    vpn_svc._vpn_failed_confs = set()
    vpn_svc._vpn_all_failed = False
    vpn_svc._wireproxy_process = None
    vpn_svc._wireproxy_conf_path = None


# ---------------------------------------------------------------------------
# record_youtube_error — gate conditions
# ---------------------------------------------------------------------------

class TestRecordYoutubeErrorGates:
    def setup_method(self):
        _reset_state()

    def teardown_method(self):
        _reset_state()

    def test_noop_when_auto_mode_off(self):
        vpn_svc._vpn_auto_mode = False
        with patch("services.vpn.is_wireproxy_active", return_value=True):
            with patch("asyncio.create_task") as mock_task:
                record_youtube_error(403)
        assert vpn_svc._vpn_error_count == 0
        mock_task.assert_not_called()

    def test_noop_when_vpn_inactive(self):
        vpn_svc._vpn_auto_mode = True
        with patch("services.vpn.is_wireproxy_active", return_value=False):
            with patch("asyncio.create_task") as mock_task:
                record_youtube_error(403)
        assert vpn_svc._vpn_error_count == 0
        mock_task.assert_not_called()

    def test_noop_for_non_blocking_status_codes(self):
        vpn_svc._vpn_auto_mode = True
        with patch("services.vpn.is_wireproxy_active", return_value=True):
            with patch("asyncio.create_task") as mock_task:
                for code in (200, 404, 500, 503):
                    record_youtube_error(code)
        assert vpn_svc._vpn_error_count == 0
        mock_task.assert_not_called()

    def test_triggers_on_403(self):
        vpn_svc._vpn_auto_mode = True
        vpn_svc._vpn_failover_threshold = 1
        with patch("services.vpn.is_wireproxy_active", return_value=True):
            with patch("asyncio.create_task") as mock_task:
                record_youtube_error(403)
        mock_task.assert_called_once()

    def test_triggers_on_429(self):
        vpn_svc._vpn_auto_mode = True
        vpn_svc._vpn_failover_threshold = 1
        with patch("services.vpn.is_wireproxy_active", return_value=True):
            with patch("asyncio.create_task") as mock_task:
                record_youtube_error(429)
        mock_task.assert_called_once()

    def test_triggers_on_451(self):
        vpn_svc._vpn_auto_mode = True
        vpn_svc._vpn_failover_threshold = 1
        with patch("services.vpn.is_wireproxy_active", return_value=True):
            with patch("asyncio.create_task") as mock_task:
                record_youtube_error(451)
        mock_task.assert_called_once()


# ---------------------------------------------------------------------------
# record_youtube_error — container mode (A6 regression test)
# ---------------------------------------------------------------------------

class TestRecordYoutubeErrorContainerMode:
    """Verify the bug fix: failover must trigger in container mode where
    _wireproxy_process is always None (the VPN runs in a separate container)."""

    def setup_method(self):
        _reset_state()

    def teardown_method(self):
        _reset_state()

    def test_container_mode_triggers_failover(self):
        """_wireproxy_process=None + is_wireproxy_active()=True → failover fires."""
        vpn_svc._vpn_auto_mode = True
        vpn_svc._vpn_failover_threshold = 1
        vpn_svc._wireproxy_process = None  # container mode: no subprocess

        with patch("services.vpn.is_wireproxy_active", return_value=True):
            with patch("asyncio.create_task") as mock_task:
                record_youtube_error(403)

        mock_task.assert_called_once()

    def test_subprocess_mode_triggers_failover(self):
        """Standard subprocess mode also triggers failover."""
        vpn_svc._vpn_auto_mode = True
        vpn_svc._vpn_failover_threshold = 1
        mock_proc = MagicMock()
        mock_proc.poll.return_value = None
        vpn_svc._wireproxy_process = mock_proc

        with patch("services.vpn.is_wireproxy_active", return_value=True):
            with patch("asyncio.create_task") as mock_task:
                record_youtube_error(403)

        mock_task.assert_called_once()

    def test_error_accumulation_before_threshold(self):
        vpn_svc._vpn_auto_mode = True
        vpn_svc._vpn_failover_threshold = 3
        vpn_svc._wireproxy_process = None

        with patch("services.vpn.is_wireproxy_active", return_value=True):
            with patch("asyncio.create_task") as mock_task:
                record_youtube_error(403)
                record_youtube_error(403)
                assert mock_task.call_count == 0
                assert vpn_svc._vpn_error_count == 2
                record_youtube_error(403)
                assert mock_task.call_count == 1

    def test_reset_clears_error_count(self):
        vpn_svc._vpn_auto_mode = True
        vpn_svc._vpn_failover_threshold = 5
        with patch("services.vpn.is_wireproxy_active", return_value=True):
            record_youtube_error(403)
        assert vpn_svc._vpn_error_count == 1
        reset_youtube_errors()
        assert vpn_svc._vpn_error_count == 0


# ---------------------------------------------------------------------------
# is_wireproxy_active — both modes
# ---------------------------------------------------------------------------

class TestIsWireproxyActive:
    def setup_method(self):
        _reset_state()

    def teardown_method(self):
        _reset_state()

    def test_subprocess_mode_active(self):
        vpn_svc.WIREPROXY_HOST_OVERRIDE = ""  # force subprocess mode check
        mock_proc = MagicMock()
        mock_proc.poll.return_value = None
        vpn_svc._wireproxy_process = mock_proc
        with patch.object(vpn_svc, "WIREPROXY_HOST", ""):
            assert is_wireproxy_active() is True

    def test_subprocess_mode_inactive_no_process(self):
        vpn_svc._wireproxy_process = None
        with patch.object(vpn_svc, "WIREPROXY_HOST", ""):
            assert is_wireproxy_active() is False

    def test_subprocess_mode_inactive_process_dead(self):
        mock_proc = MagicMock()
        mock_proc.poll.return_value = 1  # exited with code 1
        vpn_svc._wireproxy_process = mock_proc
        with patch.object(vpn_svc, "WIREPROXY_HOST", ""):
            assert is_wireproxy_active() is False

    def test_container_mode_active(self, tmp_path):
        conf = tmp_path / "vpn.conf"
        conf.write_text("[Interface]\nPrivateKey=test\n")
        with patch.object(vpn_svc, "WIREPROXY_HOST", "wireproxy"):
            with patch.object(vpn_svc, "_wireproxy_conf_path", str(conf)):
                with patch.object(vpn_svc, "_ACTIVE_CONF_PATH", str(conf)):
                    assert is_wireproxy_active() is True

    def test_container_mode_inactive_no_file(self, tmp_path):
        missing = str(tmp_path / "missing.conf")
        with patch.object(vpn_svc, "WIREPROXY_HOST", "wireproxy"):
            with patch.object(vpn_svc, "_wireproxy_conf_path", missing):
                with patch.object(vpn_svc, "_ACTIVE_CONF_PATH", missing):
                    assert is_wireproxy_active() is False
