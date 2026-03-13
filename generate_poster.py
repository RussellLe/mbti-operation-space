#!/usr/bin/env python3
"""Generate MBTI poster HTML + PNG from a markdown file.

Usage:
    python generate_poster.py result/太平年-钱弘俶-文案.md
    python generate_poster.py result/太平年-张彦泽-文案.md

Supported md format (either variant):
  - Filename: <series>-<character>-文案.md
  - MBTI type anywhere as 4 uppercase letters (INFJ / ISTJ …)
  - Optional bold quote line: **"…"**
  - MBTI dimension lines: **X 中文｜** description
  - All other non-special paragraphs → intro text
    (last paragraph becomes the highlighted closing line)

Outputs (saved to posters/):
    <series>-<character>.html
    <series>-<character>.png

Images:
    Place character photos in images/ with the character name in the filename,
    e.g. images/钱弘俶.jpg  — the script embeds them as base64 data URLs.
"""

import argparse
import re
import sys
import base64
import html as html_lib
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).parent
TEMPLATE_PATH = BASE_DIR / "太平年模板.html"
IMAGES_DIR = BASE_DIR / "images"
POSTERS_DIR = BASE_DIR / "posters"

# ---------------------------------------------------------------------------
# Static lookup tables
# ---------------------------------------------------------------------------
MBTI_EN_MAP = {
    "INFJ": "Advocate",    "INTJ": "Architect",   "INFP": "Mediator",
    "INTP": "Logician",    "ENFJ": "Protagonist",  "ENTJ": "Commander",
    "ENFP": "Campaigner",  "ENTP": "Debater",      "ISTJ": "Logistician",
    "ISFJ": "Defender",    "ESTJ": "Executive",    "ESFJ": "Consul",
    "ISTP": "Virtuoso",    "ISFP": "Adventurer",   "ESTP": "Entrepreneur",
    "ESFP": "Entertainer",
}

DIM_CN = {
    "I": ("内向", "Introverted"),  "E": ("外向", "Extraverted"),
    "N": ("直觉", "Intuitive"),    "S": ("实感", "Sensing"),
    "F": ("情感", "Feeling"),      "T": ("逻辑", "Thinking"),
    "J": ("判断", "Judging"),      "P": ("感知", "Perceiving"),
}

# Patterns for lines to skip when extracting intro paragraphs
_SKIP_PATTERNS = [
    re.compile(r"^#"),                                      # headings
    re.compile(r"^---"),                                    # separators
    re.compile(r"^\*\*[A-Z]{4}"),                           # MBTI badge  (**ISTJ …)
    re.compile(r"^\*\*[\u201c\u300c\"\u300e\u300a\u300c]"), # quote line  (**"…)
    re.compile(r"^\*\*[A-Z]\s+[\u4e00-\u9fff]+[｜|]"),     # dimension   (**I 内向｜)
]


# ---------------------------------------------------------------------------
# Image helper
# ---------------------------------------------------------------------------
def find_image(character: str) -> str:
    """Return a base64 data-URL for the first image that contains `character`
    in its filename, or '' if none is found."""
    if not IMAGES_DIR.exists():
        return ""
    exts = {".jpg", ".jpeg", ".png", ".webp"}
    for f in IMAGES_DIR.iterdir():
        if character in f.name and f.suffix.lower() in exts:
            mime = "jpeg" if f.suffix.lower() in (".jpg", ".jpeg") else f.suffix.lower().lstrip(".")
            data = base64.b64encode(f.read_bytes()).decode()
            return f"data:image/{mime};base64,{data}"
    return ""


# ---------------------------------------------------------------------------
# Markdown parser
# ---------------------------------------------------------------------------
def parse_md(md_path: Path) -> dict:
    text = md_path.read_text(encoding="utf-8")
    lines = text.splitlines()

    # ── series / character from filename ──────────────────────────────────
    parts = md_path.stem.split("-")
    series    = parts[0] if len(parts) > 0 else "太平年"
    character = parts[1] if len(parts) > 1 else md_path.stem

    # ── MBTI type (only valid combinations: [IE][NS][FT][JP]) ────────────
    m = re.search(r"\b([IE][NS][FT][JP])\b", text)
    mbti_type = m.group(1) if m else "XXXX"

    # ── MBTI Chinese title  e.g. "提倡者" or "尽职者" ────────────────────
    # Look for the MBTI code followed by · or space then CJK chars
    m = re.search(rf"{mbti_type}[\s···]+([^\s\*\|/\n<>（()）]+)", text)
    mbti_title = m.group(1).strip("()（）·· ") if m else ""

    mbti_en = MBTI_EN_MAP.get(mbti_type, "")

    # ── Quote: bold line starting with an opening quotation mark ──────────
    quote = ""
    for line in lines:
        s = line.strip()
        if re.match(r"\*\*[\u201c\u300c\"\u300e\u300a]", s):
            quote = re.sub(r"^\*\*|\*\*$", "", s).strip()
            break

    # ── MBTI dimension items  (**X 中文｜** description) ──────────────────
    mbti_items = []
    for line in lines:
        m = re.match(r"\*\*([A-Z])\s+([\u4e00-\u9fff]+)[｜|]\*\*\s*(.*)", line.strip())
        if m:
            letter = m.group(1)
            desc   = m.group(3).strip()
            cn, en = DIM_CN.get(letter, ("", ""))
            mbti_items.append({"letter": letter, "cn": cn, "en": en, "desc": desc})

    # ── Intro paragraphs: everything that is not a special line ───────────
    intro_paras = []
    for line in lines:
        s = line.strip()
        if not s:
            continue
        if any(p.match(s) for p in _SKIP_PATTERNS):
            continue
        intro_paras.append(s)

    # Last paragraph becomes the highlighted closing sentence
    highlight   = intro_paras.pop() if intro_paras else ""

    return {
        "series":     series,
        "character":  character,
        "mbti_type":  mbti_type,
        "mbti_title": mbti_title,
        "mbti_en":    mbti_en,
        "quote":      quote,
        "intro_paras": intro_paras,
        "highlight":  highlight,
        "mbti_items": mbti_items,
    }


# ---------------------------------------------------------------------------
# HTML builder
# ---------------------------------------------------------------------------
def build_html(data: dict, image_data: str) -> str:
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    e = html_lib.escape  # shorthand

    # Hero image
    img_style = (f"background-image: url('{image_data}');"
                 if image_data else "background-color: #4a4035;")

    # Intro HTML
    intro_html = "<br>\n".join(e(p) for p in data["intro_paras"])
    if data["highlight"]:
        if intro_html:
            intro_html += "<br>\n"
        intro_html += f'<span class="highlight">{e(data["highlight"])}</span>'

    # Quote box (omitted if no quote)
    quote_html = ""
    if data["quote"]:
        quote_html = f"""
        <div class="quote-box">
            <p class="quote-text">{e(data["quote"])}</p>
        </div>"""

    # MBTI grid items
    items_html = ""
    for item in data["mbti_items"]:
        items_html += f"""
            <div class="mbti-item">
                <div class="mbti-letter-box">{e(item["letter"])}</div>
                <div class="mbti-content">
                    <h3>{e(item["cn"])} | {e(item["en"])}</h3>
                    <p>{e(item["desc"])}</p>
                </div>
            </div>"""

    new_body = f"""<body>

<div class="poster-container">

    <div class="image-header-container">
        <div class="hero-image" style="{img_style}"></div>
        <div class="image-overlay-gradient"></div>
        <div class="header-info-on-image">
            <span class="series-tag">电视剧《{e(data["series"])}》</span>
            <h1 class="main-title">{e(data["character"])}</h1>
        </div>
    </div>

    <div class="content-body">

        <div class="mbti-badge-bar">
            <div class="mbti-main-badge">{e(data["mbti_type"])}</div>
            <div class="mbti-sub-badge">{e(data["mbti_title"])} ({e(data["mbti_en"])})</div>
        </div>
{quote_html}
        <div class="intro-text">
            {intro_html}
        </div>

        <div class="mbti-grid-title">人格深度解析</div>
        <div class="mbti-grid">
            {items_html}
        </div>

        <div class="footer">Designed for 小红书 · @世另我MBTI</div>

    </div>
</div>

</body>"""

    # Replace <title> and <body>…</body> in the template
    result = re.sub(
        r"<title>.*?</title>",
        f"<title>{e(data['series'])}·{e(data['character'])} {e(data['mbti_type'])} 小红书杂志风海报</title>",
        template,
    )
    result = re.sub(r"<body>.*</body>", new_body, result, flags=re.DOTALL)
    return result


# ---------------------------------------------------------------------------
# HTML → PNG via Playwright
# ---------------------------------------------------------------------------
def html_to_png(html_path: Path, png_path: Path) -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("\nERROR: playwright is not installed.")
        print("Run:  pip install playwright && playwright install chromium\n")
        sys.exit(1)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(
            viewport={"width": 520, "height": 900},
            device_scale_factor=3,          # 3× DPR → ~1560px wide, crisp text
        )
        page.goto(f"file://{html_path.absolute()}", wait_until="networkidle")
        page.wait_for_timeout(600)          # let fonts / images settle
        el = page.query_selector(".poster-container")
        if el:
            el.screenshot(path=str(png_path))
        else:
            page.screenshot(path=str(png_path), full_page=True)
        browser.close()


# ---------------------------------------------------------------------------
# CLI entry-point
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate MBTI poster (HTML + PNG) from a markdown file.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python generate_poster.py result/太平年-钱弘俶-文案.md\n"
            "  python generate_poster.py result/太平年-张彦泽-文案.md --image images/zyz.png\n"
            "  python generate_poster.py result/太平年-张彦泽-文案.md -i images/zyz.png\n"
        ),
    )
    parser.add_argument("md_file", help="Path to the .md file")
    parser.add_argument(
        "--image", "-i",
        metavar="IMAGE_PATH",
        help="Hero image to embed (overrides auto-lookup in images/). "
             "Example: --image images/zyz.png",
    )
    args = parser.parse_args()

    md_path = Path(args.md_file).resolve()
    if not md_path.exists():
        print(f"ERROR: file not found → {md_path}")
        sys.exit(1)

    POSTERS_DIR.mkdir(exist_ok=True)

    print(f"Parsing  : {md_path.name}")
    data = parse_md(md_path)
    print(f"  Series     : {data['series']}")
    print(f"  Character  : {data['character']}")
    print(f"  MBTI       : {data['mbti_type']} {data['mbti_title']} ({data['mbti_en']})")
    print(f"  Dimensions : {[i['letter'] for i in data['mbti_items']]}")
    print(f"  Quote      : {'yes' if data['quote'] else 'none'}")

    if args.image:
        img_path = Path(args.image)
        if not img_path.exists():
            print(f"ERROR: image not found → {img_path}")
            sys.exit(1)
        mime = "jpeg" if img_path.suffix.lower() in (".jpg", ".jpeg") else img_path.suffix.lower().lstrip(".")
        image_data = f"data:image/{mime};base64,{base64.b64encode(img_path.read_bytes()).decode()}"
        print(f"  Hero image : {img_path.name} (from --image)")
    else:
        image_data = find_image(data["character"])
        print(f"  Hero image : {'auto-found in images/' if image_data else 'not found — solid bg'}")

    # Output stem: strip trailing -文案
    out_stem  = md_path.stem.replace("-文案", "")
    html_path = POSTERS_DIR / f"{out_stem}.html"
    png_path  = POSTERS_DIR / f"{out_stem}.png"

    html_content = build_html(data, image_data)
    html_path.write_text(html_content, encoding="utf-8")
    print(f"\nHTML  → {html_path}")

    print("PNG   → generating via Playwright …")
    html_to_png(html_path, png_path)
    print(f"PNG   → {png_path}")
    print("\nDone.")


if __name__ == "__main__":
    main()
