"""Opt-in, sequential HTML-only source discovery. No media downloads.

Usage: python3 scripts/research/discover-sources.py --fetch
Caches are temporary, outside the deployable repository. Repeated runs reuse cache.
The output is discovery evidence, not a claim that quest steps were verified.
"""
import argparse
import hashlib
import json
import re
import subprocess
import tempfile
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, urljoin

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(tempfile.gettempdir()) / "arpia-research-html"

class Page(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.links, self.text, self.images = [], [], []
        self.anchor = None
        self.skip = 0
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ("script", "style"):
            self.skip += 1
        if tag == "a":
            self.anchor = [attrs.get("href", ""), ""]
        if tag == "img":
            self.images.append(attrs)
        if tag in ("p", "div", "li", "h1", "h2", "h3", "br", "blockquote"):
            self.text.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)
        if tag == "a" and self.anchor:
            self.links.append(self.anchor)
            self.anchor = None
        if tag in ("p", "div", "li", "h1", "h2", "h3", "blockquote"):
            self.text.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.text.append(data)
            if self.anchor is not None:
                self.anchor[1] += data

def fetch(url):
    CACHE.mkdir(exist_ok=True)
    path = CACHE / (hashlib.sha256(url.encode()).hexdigest()[:20] + ".html")
    if not path.exists():
        time.sleep(1)
        result = subprocess.run(["curl", "--silent", "--show-error", "--fail", "--location", "--max-time", "30", url], capture_output=True)
        if result.returncode:
            print(f"Unavailable: {url}", flush=True)
            return None
        path.write_bytes(result.stdout)
    return Page(path.read_text(errors="replace"))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", required=True)
    parser.parse_args()
    articles = {}
    categories = ["https://wonavy.tistory.com/category/" + quote("추억의 게임/마법학교 아르피아") + f"?page={i}" for i in range(1, 7)]
    categories += ["https://alicer.tistory.com/category/" + quote("추억의 아르피아/프리미션")]
    for url in categories:
        page = fetch(url)
        if page is None:
            continue
        for href, title in page.links:
            title = " ".join(title.split())
            target = urljoin(url, href).split("?")[0]
            if re.fullmatch(r"https://(?:wonavy|alicer)\.tistory\.com/\d+", target) and "아르피아" in title:
                articles[target] = title.split("편 제 ")[0][:230]
        print(f"Category inspected; {len(articles)} article links discovered", flush=True)
    results = []
    for url, title in sorted(articles.items()):
        page = fetch(url)
        if page is None:
            results.append(dict(url=url, title=title, accessible=False))
            continue
        lines = [x.strip() for x in "".join(page.text).splitlines() if x.strip()]
        headings = [x for x in lines if re.match(r"제\s*\d+\s*화\s*\.", x)]
        # Count HTML image references only; images have not been visually verified.
        results.append(dict(url=url, title=title, accessible=True, episodeHeadings=list(dict.fromkeys(headings)), imageReferences=len(page.images)))
        print(f"Inspected {url}: {len(headings)} episode headings", flush=True)
    for url, name in [
        ("https://www.readonly.wiki/w/" + quote("마법학교 아르피아"), "readonly-main"),
        ("https://lostmediawiki.kr/w/" + quote("마법학교 아르피아/맵"), "romi-maps"),
        ("https://tcatmon.com/wiki/" + quote("아르피아/몬스터"), "uman-monsters"),
    ]:
        page = fetch(url)
        if page:
            (CACHE / f"{name}.txt").write_text("".join(page.text))
    output = ROOT / "content/research/discovery.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(dict(accessedDate="2026-09-07", method="Sequential HTML inspection; media references counted, not downloaded or authenticated", articles=results), ensure_ascii=False, indent=2) + "\n")
    print(f"Wrote {len(results)} discovery records to {output}", flush=True)

if __name__ == "__main__":
    main()
