"""Tests for core/cache.py — TTL caches."""
import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import core.cache as cache_module
from core.cache import (
    cache_get, cache_set,
    thumb_cache_get, thumb_cache_set,
    live_url_cache_get, live_url_cache_set,
    stream_url_cache_get, stream_url_cache_set, stream_url_cache_invalidate,
)


@pytest.fixture(autouse=True)
def clear_caches():
    """Reset all caches before each test."""
    cache_module._cache.clear()
    cache_module._thumb_cache.clear()
    cache_module._channel_thumbs_cache.clear()
    cache_module._live_url_cache.clear()
    cache_module._stream_url_cache.clear()
    yield


# ---------------------------------------------------------------------------
# General TTL cache
# ---------------------------------------------------------------------------

class TestCacheGetSet:
    def test_miss_returns_none(self):
        assert cache_get("missing") is None

    def test_set_then_get(self):
        cache_set("k", {"data": 42})
        assert cache_get("k") == {"data": 42}

    def test_overwrite(self):
        cache_set("k", "first")
        cache_set("k", "second")
        assert cache_get("k") == "second"

    def test_bounded_maxsize(self):
        """TTLCache evicts LRU entries when maxsize is reached."""
        for i in range(cache_module._cache.maxsize + 5):
            cache_set(f"key_{i}", i)
        assert len(cache_module._cache) <= cache_module._cache.maxsize


# ---------------------------------------------------------------------------
# Thumbnail cache
# ---------------------------------------------------------------------------

class TestThumbCache:
    def test_miss_returns_none(self):
        assert thumb_cache_get("nope") is None

    def test_set_then_get(self):
        thumb_cache_set("img", b"\xff\xd8\xff", "image/jpeg")
        result = thumb_cache_get("img")
        assert result == (b"\xff\xd8\xff", "image/jpeg")

    def test_bounded_maxsize(self):
        """TTLCache evicts entries when maxsize is reached."""
        for i in range(cache_module._thumb_cache.maxsize + 5):
            thumb_cache_set(f"img_{i}", b"x", "image/jpeg")
        assert len(cache_module._thumb_cache) <= cache_module._thumb_cache.maxsize


# ---------------------------------------------------------------------------
# Live URL cache
# ---------------------------------------------------------------------------

class TestLiveUrlCache:
    def test_miss_returns_none(self):
        assert live_url_cache_get("vid1") is None

    def test_set_then_get(self):
        live_url_cache_set("vid1", "https://example.com/stream.m3u8")
        assert live_url_cache_get("vid1") == "https://example.com/stream.m3u8"

    def test_bounded_maxsize(self):
        """TTLCache evicts entries when maxsize is reached."""
        for i in range(cache_module._live_url_cache.maxsize + 5):
            live_url_cache_set(f"vid_{i}", f"https://example.com/{i}.m3u8")
        assert len(cache_module._live_url_cache) <= cache_module._live_url_cache.maxsize


# ---------------------------------------------------------------------------
# Stream URL cache
# ---------------------------------------------------------------------------

class TestStreamUrlCache:
    def test_miss_returns_none(self):
        assert stream_url_cache_get("stream:abc:137") is None

    def test_set_then_get(self):
        stream_url_cache_set("stream:abc:137", "https://cdn.example.com/video.mp4", "mp4")
        result = stream_url_cache_get("stream:abc:137")
        assert result == ("https://cdn.example.com/video.mp4", "mp4")

    def test_invalidate_removes_all_for_video(self):
        stream_url_cache_set("stream:abc:137", "https://cdn.example.com/v.mp4", "mp4")
        stream_url_cache_set("stream:abc:140", "https://cdn.example.com/a.webm", "webm")
        stream_url_cache_set("stream:xyz:137", "https://cdn.example.com/other.mp4", "mp4")
        stream_url_cache_invalidate("abc")
        assert stream_url_cache_get("stream:abc:137") is None
        assert stream_url_cache_get("stream:abc:140") is None
        # Other video's cache must not be affected
        assert stream_url_cache_get("stream:xyz:137") is not None

    def test_invalidate_nonexistent_no_error(self):
        stream_url_cache_invalidate("nonexistent")
