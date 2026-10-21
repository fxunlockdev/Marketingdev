"""Crawl4AI content processing of broker-fetched HTML. Network disabled by launcher."""
import contextlib
import hashlib
import io
import json
import re
import sys


def main():
    raw = sys.stdin.buffer.read(3 * 1024 * 1024 + 1)
    if len(raw) > 3 * 1024 * 1024:
        raise ValueError("input limit")
    data = json.loads(raw)
    html, url = data["html"], data["url"]
    if not isinstance(html, str) or len(html.encode()) > 2 * 1024 * 1024 or len(url) > 2048:
        raise ValueError("page limit")
    # Dependencies may emit diagnostics during import. Source text never becomes logs.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        from crawl4ai import LXMLWebScrapingStrategy
        from lxml import html as lhtml
        result = LXMLWebScrapingStrategy().scrap(url, html, word_count_threshold=1,
            exclude_all_images=True, remove_comments=True,
            excluded_tags=["script", "style", "iframe", "object", "embed", "svg", "form", "noscript"])
        if not result.success or not result.cleaned_html:
            raise ValueError("no content")
        doc = lhtml.fromstring(result.cleaned_html, parser=lhtml.HTMLParser(no_network=True))
        text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", "\n".join(t.strip() for t in doc.itertext() if t.strip()))
        title = result.metadata.get("title", "")
        description = result.metadata.get("description", "")
        text = "\n".join(x for x in [title, description, text] if isinstance(x, str) and x.strip())
        if not text.strip():
            raise ValueError("no content")
        truncated = len(text) > 40000
        text = text[:40000]
        chunks = [{"text": text[i:i+8000], "anchor": f"text:{i}"} for i in range(0, len(text), 8000)]
        links = [link.href for link in result.links.internal][:100]
    print(json.dumps({"parserVersion": "crawl4ai-0.9.5/desvio-v1", "url": url,
        "sha256": hashlib.sha256(html.encode()).hexdigest(), "chunks": chunks,
        "links": links, "truncated": truncated, "coverage": "server_html_only"}), flush=True)
