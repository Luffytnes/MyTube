"""Google News RSS API route, caching and RSS parsing helpers."""
import html as html_lib
import re
from time import time as _time
from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from services.innertube import httpx_client

router = APIRouter()

NEWS_CACHE_TTL = 900  # 15 minutes
_news_cache: Dict[str, tuple] = {}


def news_cache_get(key: str):
    if key in _news_cache:
        ts, data = _news_cache[key]
        if _time() - ts < NEWS_CACHE_TTL:
            return data
        del _news_cache[key]
    return None


def news_cache_set(key: str, data: Any):
    _news_cache[key] = (_time(), data)


GOOGLE_NEWS_CATEGORIES = {
    "general": None,
    "technology": "TECHNOLOGY",
    "business": "BUSINESS",
    "entertainment": "ENTERTAINMENT",
    "sports": "SPORTS",
    "science": "SCIENCE",
    "health": "HEALTH",
    "world": "WORLD",
    "nation": "NATION",
    "politics": "NATION",  # Google News has no POLITICS topic, NATION is closest
}

REGION_LANG_MAP = {
    "FR": "fr", "US": "en", "GB": "en", "DE": "de", "ES": "es",
    "PT": "pt", "IT": "it", "JP": "ja", "KR": "ko", "RU": "ru",
    "AR": "ar", "BR": "pt", "CA": "en", "AU": "en", "MX": "es",
    "IN": "hi", "CN": "zh", "NL": "nl", "PL": "pl", "SE": "sv",
    "NO": "no", "DK": "da", "FI": "fi", "CH": "de", "BE": "fr",
}


def _extract_raw_tag(text: str, tag: str) -> str:
    """Extract raw content of first tag occurrence, handling CDATA and encoded HTML."""
    m = re.search(rf'<{tag}[^>]*>(.*?)</{tag}>', text, re.DOTALL)
    if not m:
        return ""
    content = m.group(1).strip()
    # Unwrap CDATA if present
    cdata = re.match(r'<!\[CDATA\[(.*?)\]\]>', content, re.DOTALL)
    if cdata:
        return cdata.group(1).strip()
    # Otherwise HTML-decode (Google News uses &lt; &gt; encoded HTML)
    return html_lib.unescape(content)


def _parse_rss(xml_text: str) -> list:
    articles = []
    try:
        items = re.findall(r'<item>(.*?)</item>', xml_text, re.DOTALL)
        for raw in items:
            title = re.sub(r"<[^>]+>", "", _extract_raw_tag(raw, "title")).strip()
            if not title:
                continue

            # <link> in RSS 2.0 is a bare text node
            link_m = re.search(r'<link>(.*?)</link>', raw, re.DOTALL)
            link = link_m.group(1).strip() if link_m else ""

            pub_date = _extract_raw_tag(raw, "pubDate")

            # Source
            source_m = re.search(r'<source[^>]*>(.*?)</source>', raw, re.DOTALL)
            source = source_m.group(1).strip() if source_m else ""

            # Description: HTML-decode then extract image and clean text
            desc_html = _extract_raw_tag(raw, "description")

            # Image: look for <img src="..."> in decoded HTML
            image = None
            img_m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', desc_html)
            if img_m:
                image = img_m.group(1)
            if not image:
                media_m = re.search(r'<media:content[^>]+url=["\']([^"\']+)["\']', raw)
                if media_m:
                    image = media_m.group(1)

            # Strip HTML tags from description, collapse whitespace
            clean_desc = re.sub(r"<[^>]+>", " ", desc_html)
            clean_desc = clean_desc.replace("\xa0", " ")  # non-breaking spaces
            clean_desc = re.sub(r"\s{2,}", " ", clean_desc).strip()
            if len(clean_desc) > 220:
                clean_desc = clean_desc[:220] + "…"

            articles.append({
                "title": title,
                "link": link,
                "pubDate": pub_date,
                "source": source,
                "description": clean_desc,
                "image": image,
            })
    except Exception:
        pass
    return articles


@router.get("/api/news")
async def get_news(region: str = "FR", category: str = "general"):
    cache_key = f"news:{region}:{category}"
    cached = news_cache_get(cache_key)
    if cached:
        return cached

    lang = REGION_LANG_MAP.get(region.upper(), "en")
    country = region.upper()
    cat = GOOGLE_NEWS_CATEGORIES.get(category.lower())

    if cat:
        url = f"https://news.google.com/rss/headlines/section/topic/{cat}?hl={lang}&gl={country}&ceid={country}:{lang}"
    else:
        url = f"https://news.google.com/rss?hl={lang}&gl={country}&ceid={country}:{lang}"

    try:
        async with httpx_client(timeout=10.0) as client:
            r = await client.get(url, headers={"User-Agent": "Mozilla/5.0"}, follow_redirects=True)
            if r.status_code != 200:
                raise HTTPException(status_code=502, detail="Failed to fetch news feed")
            articles = _parse_rss(r.text)
            result = {"articles": articles, "region": region, "category": category}
            news_cache_set(cache_key, result)
            return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
