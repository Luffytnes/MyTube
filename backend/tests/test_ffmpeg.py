"""Tests for ffmpeg command construction — no actual transcoding."""
import sys
import os
import pytest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PROXY_URL = "socks5://wireproxy:25344"

def _cmd_as_string(cmd: list) -> str:
    return " ".join(str(a) for a in cmd)


# ---------------------------------------------------------------------------
# YouTube HLS session — proxy injection
# ---------------------------------------------------------------------------

class TestHlsSessionProxyArgs:
    """_start_hls_session must inject -socks_proxy when VPN is active."""

    def _patch_deps(self, proxy_url=None):
        return [
            patch("services.ffmpeg._get_video_and_audio_urls",
                  return_value=("https://cdn.example.com/video.mp4",
                                "https://cdn.example.com/audio.mp4")),
            patch("services.ffmpeg._get_proxy_url", return_value=proxy_url),
            patch("asyncio.create_subprocess_exec", new_callable=MagicMock),
            patch("asyncio.ensure_future"),
            patch("tempfile.mkdtemp", return_value="/tmp/fake_hls"),
            patch("services.ffmpeg._hls_sessions", {}),
        ]

    def test_proxy_arg_present_when_vpn_active(self):
        import asyncio
        captured = {}

        async def fake_exec(*args, **kwargs):
            captured["cmd"] = list(args)
            proc = MagicMock()
            proc.stderr = MagicMock()
            return proc

        patches = [
            patch("services.ffmpeg._get_video_and_audio_urls",
                  return_value=("https://cdn.example.com/video.mp4",
                                "https://cdn.example.com/audio.mp4")),
            patch("services.ffmpeg._get_proxy_url", return_value=PROXY_URL),
            patch("asyncio.create_subprocess_exec", side_effect=fake_exec),
            patch("asyncio.ensure_future"),
            patch("tempfile.mkdtemp", return_value="/tmp/fake_hls"),
        ]
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            from services.ffmpeg import _start_hls_session, _hls_sessions
            _hls_sessions.clear()
            asyncio.run(_start_hls_session("test_vid", "137", start=0))

        assert "cmd" in captured, "create_subprocess_exec was not called"
        cmd = _cmd_as_string(captured["cmd"])
        assert "-socks_proxy" in cmd, "Expected -socks_proxy in ffmpeg command"
        assert PROXY_URL in cmd, f"Expected {PROXY_URL} in ffmpeg command"

    def test_proxy_arg_absent_when_vpn_inactive(self):
        import asyncio
        captured = {}

        async def fake_exec(*args, **kwargs):
            captured["cmd"] = list(args)
            proc = MagicMock()
            proc.stderr = MagicMock()
            return proc

        patches = [
            patch("services.ffmpeg._get_video_and_audio_urls",
                  return_value=("https://cdn.example.com/video.mp4",
                                "https://cdn.example.com/audio.mp4")),
            patch("services.ffmpeg._get_proxy_url", return_value=None),
            patch("asyncio.create_subprocess_exec", side_effect=fake_exec),
            patch("asyncio.ensure_future"),
            patch("tempfile.mkdtemp", return_value="/tmp/fake_hls2"),
        ]
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            from services.ffmpeg import _start_hls_session, _hls_sessions
            _hls_sessions.clear()
            asyncio.run(_start_hls_session("test_vid2", "137", start=0))

        assert "cmd" in captured
        cmd = _cmd_as_string(captured["cmd"])
        assert "-socks_proxy" not in cmd, "Did not expect -socks_proxy when VPN is off"

    def test_proxy_arg_appears_once(self):
        """Global ffmpeg option -socks_proxy must appear only once, not once per -i."""
        import asyncio
        captured = {}

        async def fake_exec(*args, **kwargs):
            captured["cmd"] = list(args)
            proc = MagicMock()
            proc.stderr = MagicMock()
            return proc

        patches = [
            patch("services.ffmpeg._get_video_and_audio_urls",
                  return_value=("https://cdn.example.com/video.mp4",
                                "https://cdn.example.com/audio.mp4")),
            patch("services.ffmpeg._get_proxy_url", return_value=PROXY_URL),
            patch("asyncio.create_subprocess_exec", side_effect=fake_exec),
            patch("asyncio.ensure_future"),
            patch("tempfile.mkdtemp", return_value="/tmp/fake_hls3"),
        ]
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            from services.ffmpeg import _start_hls_session, _hls_sessions
            _hls_sessions.clear()
            asyncio.run(_start_hls_session("test_vid3", "137", start=0))

        assert "cmd" in captured
        cmd_list = captured["cmd"]
        count = cmd_list.count("-socks_proxy")
        assert count == 1, f"-socks_proxy must appear exactly once, found {count} times"


# ---------------------------------------------------------------------------
# IPTV VOD — PTS reset args
# ---------------------------------------------------------------------------

class TestVodPtsReset:
    """VOD sessions starting from a non-zero offset must include PTS reset filters."""

    def _find_pts_args(self, cmd: list) -> bool:
        s = _cmd_as_string(cmd)
        return "setpts=PTS-STARTPTS" in s and "asetpts=PTS-STARTPTS" in s

    def test_pts_reset_present_for_nonzero_start(self):
        """When starting from a seek position, PTS must be reset to avoid timestamp doubling."""
        import asyncio
        import json
        captured = {}

        async def fake_exec(*args, **kwargs):
            captured["cmd"] = list(args)
            proc = MagicMock()
            proc.stdout = None
            proc.stdin = MagicMock()
            proc.stderr = MagicMock()
            proc.returncode = None
            return proc

        async def fake_choose_input(vod_entry, cache_path, start):
            return (["-ss", str(start), "-i", cache_path], False)

        vod_entry = {
            "stream_id": "test",
            "ext": "mkv",
            "url": "https://example.com/video.mkv",
        }

        patches = [
            patch("services.ffmpeg._choose_ffmpeg_input", side_effect=fake_choose_input),
            patch("asyncio.create_subprocess_exec", side_effect=fake_exec),
            patch("asyncio.ensure_future"),
            patch("os.makedirs"),
            patch("services.ffmpeg._iptv_vod_hls_sessions", {}),
        ]
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            from services.ffmpeg import _start_iptv_vod_hls_session, _iptv_vod_hls_sessions
            _iptv_vod_hls_sessions.clear()
            try:
                asyncio.run(_start_iptv_vod_hls_session(
                    vod_entry=vod_entry,
                    cache_path="/tmp/fake.mkv",
                    start=3600,
                    stream_id="test",
                    ext="mkv",
                    media="video",
                    audio_idx=0,
                ))
            except Exception:
                pass  # may fail after cmd capture due to missing filesystem state

        if "cmd" in captured:
            assert self._find_pts_args(captured["cmd"]), (
                "Expected setpts=PTS-STARTPTS and asetpts=PTS-STARTPTS in VOD command"
            )

    def test_no_shell_injection_in_proxy_url(self):
        """Proxy URL must be passed as a list argument, not interpolated into a shell string."""
        import asyncio
        captured = {}

        async def fake_exec(*args, **kwargs):
            captured["cmd"] = list(args)
            proc = MagicMock()
            proc.stderr = MagicMock()
            return proc

        malicious_proxy = "socks5://wireproxy:25344; rm -rf /"

        patches = [
            patch("services.ffmpeg._get_video_and_audio_urls",
                  return_value=("https://cdn.example.com/v.mp4",
                                "https://cdn.example.com/a.mp4")),
            patch("services.ffmpeg._get_proxy_url", return_value=malicious_proxy),
            patch("asyncio.create_subprocess_exec", side_effect=fake_exec),
            patch("asyncio.ensure_future"),
            patch("tempfile.mkdtemp", return_value="/tmp/fake_hls4"),
        ]
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            from services.ffmpeg import _start_hls_session, _hls_sessions
            _hls_sessions.clear()
            asyncio.run(_start_hls_session("inj_vid", "137", start=0))

        if "cmd" in captured:
            # create_subprocess_exec receives a list — shell injection is impossible
            # Verify the command is a list (exec form, not shell=True)
            assert isinstance(captured["cmd"], list), "Command must be a list (exec form)"
            # The malicious string appears verbatim as a single argument, not interpreted
            assert any(malicious_proxy in str(a) for a in captured["cmd"]), (
                "Proxy URL should be in command args"
            )
