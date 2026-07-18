"""Tests for VPN failover logic — especially record_youtube_error() in container mode."""
import asyncio
import sys
import os
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services import vpn as vpn_svc
from services.vpn import record_youtube_error, reset_youtube_errors, is_wireproxy_active
from services.innertube import ydl_extract


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


# ---------------------------------------------------------------------------
# ydl_extract — VPN failover wiring
# ---------------------------------------------------------------------------

class TestYdlExtract:
    def setup_method(self):
        _reset_state()

    def teardown_method(self):
        _reset_state()

    def test_blocking_error_calls_record_youtube_error(self):
        """'Sign in to confirm you're not a bot' must increment the VPN error counter."""
        vpn_svc._vpn_auto_mode = True
        vpn_svc._vpn_failover_threshold = 99  # prevent actual failover task
        exc = Exception("Sign in to confirm you're not a bot")

        with patch("services.vpn.is_wireproxy_active", return_value=True):
            with patch("services.innertube.yt_dlp.YoutubeDL") as mock_ydl_cls:
                mock_ydl_cls.return_value.__enter__.return_value.extract_info.side_effect = exc
                mock_ydl_cls.return_value.__exit__ = MagicMock(return_value=False)
                import pytest
                with pytest.raises(Exception, match="Sign in to confirm"):
                    asyncio.run(ydl_extract("https://www.youtube.com/watch?v=test", {}))

        assert vpn_svc._vpn_error_count == 1

    def test_http_error_403_calls_record_youtube_error(self):
        """'HTTP Error 403' must increment the VPN error counter."""
        vpn_svc._vpn_auto_mode = True
        vpn_svc._vpn_failover_threshold = 99
        exc = Exception("HTTP Error 403: Forbidden")

        with patch("services.vpn.is_wireproxy_active", return_value=True):
            with patch("services.innertube.yt_dlp.YoutubeDL") as mock_ydl_cls:
                mock_ydl_cls.return_value.__enter__.return_value.extract_info.side_effect = exc
                mock_ydl_cls.return_value.__exit__ = MagicMock(return_value=False)
                import pytest
                with pytest.raises(Exception):
                    asyncio.run(ydl_extract("https://www.youtube.com/watch?v=test", {}))

        assert vpn_svc._vpn_error_count == 1

    def test_private_video_does_not_call_record_youtube_error(self):
        """'Private video' must NOT increment the VPN error counter."""
        vpn_svc._vpn_auto_mode = True
        vpn_svc._vpn_failover_threshold = 99
        exc = Exception("This is a private video. Please sign in to verify that you may see it.")

        with patch("services.vpn.is_wireproxy_active", return_value=True):
            with patch("services.innertube.yt_dlp.YoutubeDL") as mock_ydl_cls:
                mock_ydl_cls.return_value.__enter__.return_value.extract_info.side_effect = exc
                mock_ydl_cls.return_value.__exit__ = MagicMock(return_value=False)
                import pytest
                with pytest.raises(Exception):
                    asyncio.run(ydl_extract("https://www.youtube.com/watch?v=test", {}))

        assert vpn_svc._vpn_error_count == 0

    def test_successful_extraction_resets_error_counter(self):
        """A successful ydl_extract call resets the error counter to zero."""
        vpn_svc._vpn_error_count = 3
        fake_info = {"id": "test", "title": "Test Video", "formats": []}

        with patch("services.innertube.yt_dlp.YoutubeDL") as mock_ydl_cls:
            mock_ydl_cls.return_value.__enter__.return_value.extract_info.return_value = fake_info
            mock_ydl_cls.return_value.__exit__ = MagicMock(return_value=False)
            result = asyncio.run(ydl_extract("https://www.youtube.com/watch?v=test", {}))

        assert result == fake_info
        assert vpn_svc._vpn_error_count == 0

    def test_exception_is_reraised_on_blocking_error(self):
        """The original exception must propagate to the caller even on blocking errors."""
        vpn_svc._vpn_auto_mode = True
        vpn_svc._vpn_failover_threshold = 99
        exc = Exception("HTTP Error 429: Too Many Requests")

        with patch("services.vpn.is_wireproxy_active", return_value=True):
            with patch("services.innertube.yt_dlp.YoutubeDL") as mock_ydl_cls:
                mock_ydl_cls.return_value.__enter__.return_value.extract_info.side_effect = exc
                mock_ydl_cls.return_value.__exit__ = MagicMock(return_value=False)
                import pytest
                with pytest.raises(Exception) as exc_info:
                    asyncio.run(ydl_extract("https://www.youtube.com/watch?v=test", {}))
                assert exc_info.value is exc

    def test_exception_is_reraised_on_non_blocking_error(self):
        """The original exception must propagate even for non-blocking errors."""
        exc = Exception("Video unavailable")

        with patch("services.innertube.yt_dlp.YoutubeDL") as mock_ydl_cls:
            mock_ydl_cls.return_value.__enter__.return_value.extract_info.side_effect = exc
            mock_ydl_cls.return_value.__exit__ = MagicMock(return_value=False)
            import pytest
            with pytest.raises(Exception, match="Video unavailable"):
                asyncio.run(ydl_extract("https://www.youtube.com/watch?v=test", {}))
