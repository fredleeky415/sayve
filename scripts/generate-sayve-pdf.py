from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Image as PdfImage
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "outputs" / "pdf"
ASSET_DIR = OUT_DIR / "assets"
PDF_PATH = OUT_DIR / "sayve-manifesto-mechanics-ui.pdf"

PAGE_W, PAGE_H = A4
MARGIN_X = 18 * mm
TOP = PAGE_H - 18 * mm
BOTTOM = 18 * mm

FONT_REGULAR = "STHeitiLight"
FONT_BOLD = "STHeitiMedium"

pdfmetrics.registerFont(TTFont(FONT_REGULAR, "/System/Library/Fonts/STHeiti Light.ttc"))
pdfmetrics.registerFont(TTFont(FONT_BOLD, "/System/Library/Fonts/STHeiti Medium.ttc"))


BG = colors.HexColor("#050507")
PANEL = colors.HexColor("#12151b")
PANEL_2 = colors.HexColor("#191d24")
INK = colors.HexColor("#f7f7f8")
MUTED = colors.HexColor("#a8adb8")
SOFT = colors.HexColor("#d7dce5")
LINE = colors.Color(1, 1, 1, alpha=0.14)
ACCENT = colors.HexColor("#dff7f0")
WARM = colors.HexColor("#ff8a6a")


def pstyle(name: str, size: int, leading: int, color=SOFT, font=FONT_REGULAR, align=TA_LEFT, space_after=5):
    return ParagraphStyle(
        name,
        fontName=font,
        fontSize=size,
        leading=leading,
        textColor=color,
        alignment=align,
        wordWrap="CJK",
        spaceAfter=space_after,
    )


STYLE_BODY = pstyle("Body", 9, 15)
STYLE_SMALL = pstyle("Small", 7.5, 12, MUTED)
STYLE_TITLE = pstyle("Title", 28, 34, INK, FONT_BOLD)
STYLE_H1 = pstyle("H1", 19, 25, INK, FONT_BOLD)
STYLE_H2 = pstyle("H2", 13, 18, INK, FONT_BOLD)
STYLE_QUOTE = pstyle("Quote", 13, 22, ACCENT, FONT_REGULAR, TA_CENTER)
STYLE_CENTER = pstyle("Center", 9, 15, SOFT, FONT_REGULAR, TA_CENTER)


def clean(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br/>")
    )


def draw_bg(c: Canvas, title: str | None = None, page_no: int | None = None):
    c.setFillColor(BG)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    c.setFillColor(colors.Color(0.25, 0.95, 0.88, alpha=0.08))
    c.circle(25 * mm, PAGE_H - 18 * mm, 58 * mm, stroke=0, fill=1)
    c.setFillColor(colors.Color(1.0, 0.36, 0.28, alpha=0.06))
    c.circle(PAGE_W - 22 * mm, PAGE_H - 32 * mm, 62 * mm, stroke=0, fill=1)
    c.setStrokeColor(LINE)
    c.line(MARGIN_X, PAGE_H - 13 * mm, PAGE_W - MARGIN_X, PAGE_H - 13 * mm)
    if title:
        c.setFillColor(MUTED)
        c.setFont(FONT_REGULAR, 7.5)
        c.drawString(MARGIN_X, PAGE_H - 10 * mm, title)
    if page_no:
        c.setFillColor(MUTED)
        c.setFont(FONT_REGULAR, 7.5)
        c.drawRightString(PAGE_W - MARGIN_X, 10 * mm, f"{page_no:02d}")


def para(c: Canvas, text: str, x: float, y: float, w: float, style: ParagraphStyle = STYLE_BODY) -> float:
    p = Paragraph(clean(text), style)
    _, h = p.wrap(w, 1000)
    p.drawOn(c, x, y - h)
    return y - h - style.spaceAfter


def panel(c: Canvas, x: float, y: float, w: float, h: float, fill=PANEL):
    c.setFillColor(fill)
    c.setStrokeColor(LINE)
    c.roundRect(x, y - h, w, h, 5 * mm, stroke=1, fill=1)


def bullets(c: Canvas, items: Iterable[str], x: float, y: float, w: float) -> float:
    for item in items:
        c.setFillColor(ACCENT)
        c.circle(x + 2 * mm, y - 4 * mm, 1.2 * mm, stroke=0, fill=1)
        y = para(c, item, x + 7 * mm, y, w - 7 * mm, STYLE_BODY)
    return y


def image_fit(c: Canvas, path: Path, x: float, y: float, w: float, h: float):
    with Image.open(path) as img:
        iw, ih = img.size
    scale = min(w / iw, h / ih)
    dw, dh = iw * scale, ih * scale
    c.drawImage(str(path), x + (w - dw) / 2, y - dh, dw, dh, preserveAspectRatio=True, mask="auto")


def crop_asset(source: str, target: str, box: tuple[int, int, int, int]):
    src = ASSET_DIR / source
    dst = ASSET_DIR / target
    with Image.open(src) as img:
        img.crop(box).save(dst)


def make_crops():
    with Image.open(ASSET_DIR / "sayve-dashboard.png") as img:
        w, h = img.size
        crop_asset("sayve-dashboard.png", "sayve-dashboard-top.png", (0, 0, w, min(h, 1900)))
        crop_asset("sayve-dashboard.png", "sayve-dashboard-list.png", (0, max(0, h - 1500), w, h))
    with Image.open(ASSET_DIR / "sayve-founder-console.png") as img:
        w, h = img.size
        crop_asset("sayve-founder-console.png", "sayve-founder-top.png", (0, 0, min(w, 1500), min(h, 1350)))


FUTURE_VISION = [
    (
        "The Future Vision of Sayve",
        [
            "我會寫呢份唔係 Roadmap。",
            "而係：The Future Vision of Sayve。",
            "我希望你半年、一年之後再睇，都仍然會覺得：係，我就係想做呢樣嘢。",
            "我們不是在建立一個記帳 App。我們正在建立一個新的關係。",
            "以前，人和金錢的關係是：花錢，忘記，月底才發現。",
            "人不是沒有花時間管理金錢，而是根本沒有能力記住自己的財務人生。",
            "記帳從來不是目的。很多人說：我應該記帳。但真正想要的，不是一本帳簿。",
            "真正想要的是：我知道自己錢去了哪裡；我知道自己沒有失控；我知道自己正在向目標前進；我知道現在一切正常。",
            "記帳只是過去唯一的方法。AI 出現之後，它不應該只是讓記帳更快，它應該讓「記帳」這件事消失。",
        ],
    ),
    (
        "Sayve 的願景",
        [
            "我們希望建立一個永遠陪伴家庭成長的 Financial Memory。",
            "這個 Memory 不只是記錄。它會理解、學習、比較、提醒、解釋、陪伴。",
            "它不是一本電子帳簿。它是一個真正理解你家庭財務的 AI。",
        ],
    ),
    (
        "第一章：Capture",
        [
            "今天，你只需要照常生活。",
            "食飯。買東西。收到人工。交保費。買奶粉。",
            "你不用打開記帳 App。你只需要說一句、打幾個字、拍一張收據，AI 就開始工作。",
        ],
    ),
    (
        "第二章：Memory",
        [
            "每一次 Capture，都不是建立一筆 Transaction，而是建立一段 Financial Memory。",
            "例如：今天同老婆食飯。",
            "AI 記住的不只是 HK$380。它記住日期、地點、商戶、類型、家庭 Context，以及與過去的關係。",
            "每一天，Memory 都在成長。",
        ],
    ),
    (
        "第三章：Understanding",
        [
            "AI 不再只是知道你花了多少。AI 開始理解你的生活正在發生什麼。",
            "例如：AI 發現最近 Lunch 愈來愈貴，不是因為你亂花錢，而是你換了工作，公司附近餐廳平均比較貴。",
            "AI 不只是回答。AI 開始理解原因。",
        ],
    ),
    (
        "第四章：Awareness",
        [
            "這是 Sayve 第一個真正的價值。AI 不再等待你查詢，它開始讓你知道原本不知道的事情。",
            "例如：最近三星期 Dining 比平時高了 18%，原因主要來自週末聚餐，目前仍然屬於正常範圍。",
            "又例如：BB 的開支開始下降。奶粉比例下降，教育相關支出開始增加。",
            "這不是 Dashboard。這是 Awareness。",
        ],
    ),
    (
        "第五章：Confidence",
        [
            "真正的高收入人士，很多時不是因為沒有錢，而是不知不覺花多了。",
            "每天 Lunch、Coffee、Uber、Shopping，每一筆都不痛。真正危險的是半年後才發現。",
            "Sayve 希望提供一種新的感覺。不是控制你，而是陪伴你。",
            "每星期，AI 可以告訴你：一切正常，你仍然 On Track。或者：最近需要留意 Shopping，你開始偏離自己的習慣。",
            "這不是 Budget。這是 Financial Confidence。",
        ],
    ),
    (
        "第六章：Decision",
        [
            "AI 不只是報告。它開始協助決策。",
            "如果保持目前支出，今年旅行預算可能不足。",
            "如果取消兩個很少使用的 Subscription，一年可以多一次旅行。",
            "如果最近 Dining 上升，真正原因不是餐廳，而是外賣頻率增加。",
            "AI 不提供命令。AI 提供判斷。",
        ],
    ),
    (
        "第七章：Autopilot",
        [
            "最後，AI 開始成為家庭的財務副駕。",
            "Netflix 已三個月沒有觀看，要不要取消？",
            "今年管理費尚未出現，是否需要確認？",
            "你每年七月都會續保，目前仍未看到相關支出，需要提醒嗎？",
            "AI 不只是回答。AI 開始照顧。",
        ],
    ),
    (
        "最終形態",
        [
            "有一天，人不再說：我要去記帳。也不再說：我要開 Dashboard。甚至不再說：我要管理財務。",
            "而是自然地說：問一下 Sayve。跟 Sayve 說一聲。",
            "AI 記住你的財務人生。AI 理解你的生活模式。AI 幫助你保持清晰。",
            "我們真正販賣的不是 AI，不是 OCR，不是 Dashboard，甚至不是 Financial Memory。",
            "我們販賣的是 Financial Clarity。",
            "知道自己正在發生什麼。知道自己沒有失控。知道自己仍然朝著目標前進。",
            "以及：不需要再把這些事情放在腦裡。",
        ],
    ),
    (
        "Sayve 的北極星",
        [
            "People shouldn't spend their lives tracking money.",
            "Money should quietly take care of itself, while AI keeps them aware.",
            "We don't help people keep books. We help people stay financially aware, without thinking about bookkeeping.",
            "這不是一個功能描述。這是一間產品公司存在的理由。",
        ],
    ),
]


def add_cover(c: Canvas):
    draw_bg(c)
    y = PAGE_H - 58 * mm
    y = para(c, "Sayve", MARGIN_X, y, PAGE_W - 2 * MARGIN_X, STYLE_TITLE)
    y = para(c, "Manifesto & Mechanics", MARGIN_X, y - 2 * mm, PAGE_W - 2 * MARGIN_X, pstyle("Subtitle", 18, 24, MUTED))
    y = para(
        c,
        "AI Native Family Financial Memory\nPrepared for business advisor review\n2026-07-09",
        MARGIN_X,
        y - 10 * mm,
        PAGE_W - 2 * MARGIN_X,
        STYLE_BODY,
    )
    panel(c, MARGIN_X, y - 8 * mm, PAGE_W - 2 * MARGIN_X, 42 * mm, PANEL_2)
    para(
        c,
        "We don't help people keep books.\nWe help people stay financially aware, without thinking about bookkeeping.",
        MARGIN_X + 10 * mm,
        y - 20 * mm,
        PAGE_W - 2 * MARGIN_X - 20 * mm,
        STYLE_QUOTE,
    )
    c.showPage()


def add_future_pages(c: Canvas, start_page: int) -> int:
    page = start_page
    draw_bg(c, "The Future Vision of Sayve", page)
    y = TOP - 12 * mm
    y = para(c, "The Future Vision of Sayve", MARGIN_X, y, PAGE_W - 2 * MARGIN_X, STYLE_H1)
    for title, paragraphs in FUTURE_VISION:
        if y < 54 * mm:
            c.showPage()
            page += 1
            draw_bg(c, "The Future Vision of Sayve", page)
            y = TOP - 8 * mm
        y = para(c, title, MARGIN_X, y - 4 * mm, PAGE_W - 2 * MARGIN_X, STYLE_H2)
        for paragraph in paragraphs:
            if y < 35 * mm:
                c.showPage()
                page += 1
                draw_bg(c, "The Future Vision of Sayve", page)
                y = TOP - 8 * mm
            y = para(c, paragraph, MARGIN_X, y, PAGE_W - 2 * MARGIN_X, STYLE_BODY)
    c.showPage()
    return page + 1


def add_manifesto(c: Canvas, page: int) -> int:
    draw_bg(c, "Product Manifesto", page)
    y = TOP - 10 * mm
    y = para(c, "Product Manifesto", MARGIN_X, y, PAGE_W - 2 * MARGIN_X, STYLE_H1)
    y = para(
        c,
        "Sayve is not a bookkeeping app with AI added on top. It is a memory system where capture comes first, AI interprets what happened, facts remain sacred, context evolves, and conversation becomes the primary way to read family finance.",
        MARGIN_X,
        y,
        PAGE_W - 2 * MARGIN_X,
        STYLE_BODY,
    )
    y = bullets(
        c,
        [
            "Capture First: receive the memory before asking the user to structure it.",
            "Memory Before Database: database is the storage projection, not the product starting point.",
            "Facts Are Sacred: true historical events should not be silently overwritten.",
            "Context Evolves: household state changes over time and affects future expectations.",
            "Every Tap Is A Tax: AI should decide whenever confidence is high enough.",
            "Good News = Silent: only low confidence or meaningful changes should interrupt.",
            "One Household, One Memory: each family member logs in separately, but writes into one shared family memory.",
            "Dashboard Is A View: the core flow is Capture -> Memory -> Conversation.",
        ],
        MARGIN_X,
        y - 4 * mm,
        PAGE_W - 2 * MARGIN_X,
    )
    panel(c, MARGIN_X, y - 4 * mm, PAGE_W - 2 * MARGIN_X, 28 * mm, PANEL_2)
    para(
        c,
        "Highest principle: any design decision should strengthen Memory before it strengthens bookkeeping.",
        MARGIN_X + 8 * mm,
        y - 14 * mm,
        PAGE_W - 2 * MARGIN_X - 16 * mm,
        STYLE_QUOTE,
    )
    c.showPage()
    return page + 1


def add_mechanics(c: Canvas, page: int) -> int:
    draw_bg(c, "Product & AI Mechanics", page)
    y = TOP - 10 * mm
    y = para(c, "How Sayve Works", MARGIN_X, y, PAGE_W - 2 * MARGIN_X, STYLE_H1)
    cols = [
        (
            "1. Capture Layer",
            "Stores raw text, voice transcript, receipt source reference, timestamp, member attribution, and device/source metadata.",
        ),
        (
            "2. Interpretation Layer",
            "AI classifies intent, extracts structure, records confidence, model, prompt version, cost, latency, and decision state.",
        ),
        (
            "3. Fact Layer",
            "Stores immutable financial facts such as date, amount, merchant, category, direction, ownership scope, and sources.",
        ),
        (
            "4. Context Layer",
            "Stores current household state: subscriptions cancelled, child stage, new job, moved home, car sold, recurring changes.",
        ),
        (
            "5. Relationship Layer",
            "Connects captures, receipts, facts, context, aliases, corrections, insights, and conversation answers.",
        ),
    ]
    for title, body in cols:
        panel(c, MARGIN_X, y, PAGE_W - 2 * MARGIN_X, 27 * mm)
        para(c, title, MARGIN_X + 7 * mm, y - 7 * mm, PAGE_W - 2 * MARGIN_X - 14 * mm, STYLE_H2)
        para(c, body, MARGIN_X + 7 * mm, y - 16 * mm, PAGE_W - 2 * MARGIN_X - 14 * mm, STYLE_SMALL)
        y -= 31 * mm

    c.showPage()
    page += 1
    draw_bg(c, "AI Decision Mechanics", page)
    y = TOP - 10 * mm
    y = para(c, "AI Decision Flow", MARGIN_X, y, PAGE_W - 2 * MARGIN_X, STYLE_H1)
    y = bullets(
        c,
        [
            "High confidence: create or update memory, auto-confirm, and stay quiet.",
            "Medium confidence: create memory now, mark review_later, and avoid interrupting the habit.",
            "Low confidence: ask one minimal question only when the missing detail materially affects the memory.",
            "High impact: keep reversible audit trail even when confidence is high.",
            "Merge logic: voice '今日食飯300' and receipt HK$298.5 should become one memory, not two transactions.",
            "Conversation: retrieve structured facts first, then use AI to explain briefly and clearly.",
            "Dashboard/list/calendar views: generated from structured memory data without extra AI calls.",
        ],
        MARGIN_X,
        y,
        PAGE_W - 2 * MARGIN_X,
    )
    y = para(c, "Cost Mechanics", MARGIN_X, y - 4 * mm, PAGE_W - 2 * MARGIN_X, STYLE_H2)
    bullets(
        c,
        [
            "Cheap model for daily capture extraction; stronger model only for complex reasoning.",
            "Receipt vision and speech-to-text are optional media steps with file size/type guardrails.",
            "Every AI call records model, token, cost, confidence, latency, and outcome for Founder Console analysis.",
            "Standard dashboard and timeline should not call AI on every view.",
        ],
        MARGIN_X,
        y,
        PAGE_W - 2 * MARGIN_X,
    )
    c.showPage()
    return page + 1


def add_ui_pages(c: Canvas, page: int) -> int:
    draw_bg(c, "Product Interface", page)
    y = TOP - 8 * mm
    y = para(c, "Interface: Capture and Ask", MARGIN_X, y, PAGE_W - 2 * MARGIN_X, STYLE_H1)
    y = para(
        c,
        "The product home is intentionally light. Sayve should feel like dropping one thought into memory, not operating bookkeeping software.",
        MARGIN_X,
        y,
        PAGE_W - 2 * MARGIN_X,
        STYLE_BODY,
    )
    image_w = (PAGE_W - 2 * MARGIN_X - 8 * mm) / 2
    image_h = 145 * mm
    image_fit(c, ASSET_DIR / "sayve-home.png", MARGIN_X, y - 5 * mm, image_w, image_h)
    image_fit(c, ASSET_DIR / "sayve-ask.png", MARGIN_X + image_w + 8 * mm, y - 5 * mm, image_w, image_h)
    para(c, "Home: 跟 Sayve 說一件事", MARGIN_X, 28 * mm, image_w, STYLE_CENTER)
    para(c, "Ask: 問一問 Sayve", MARGIN_X + image_w + 8 * mm, 28 * mm, image_w, STYLE_CENTER)
    c.showPage()

    page += 1
    draw_bg(c, "Dashboard As A View", page)
    y = TOP - 8 * mm
    y = para(c, "Dashboard is a View Over Memory", MARGIN_X, y, PAGE_W - 2 * MARGIN_X, STYLE_H1)
    y = para(
        c,
        "Monthly totals, category spending, daily calendar, custom categories, and memory list should be generated from structured facts. This should not require another AI call every time.",
        MARGIN_X,
        y,
        PAGE_W - 2 * MARGIN_X,
        STYLE_BODY,
    )
    image_fit(c, ASSET_DIR / "sayve-dashboard-top.png", MARGIN_X, y - 4 * mm, PAGE_W - 2 * MARGIN_X, 160 * mm)
    c.showPage()

    page += 1
    draw_bg(c, "Founder Console", page)
    y = TOP - 8 * mm
    y = para(c, "Founder Console: AI Product Monitoring", MARGIN_X, y, PAGE_W - 2 * MARGIN_X, STYLE_H1)
    y = para(
        c,
        "The internal console is not a user dashboard. It exists to monitor AI cost, memory quality, product usage, launch readiness, and raw memory tables so the founder can keep improving the Memory Engine.",
        MARGIN_X,
        y,
        PAGE_W - 2 * MARGIN_X,
        STYLE_BODY,
    )
    image_fit(c, ASSET_DIR / "sayve-founder-top.png", MARGIN_X, y - 3 * mm, PAGE_W - 2 * MARGIN_X, 156 * mm)
    c.showPage()
    return page + 1


def add_business(c: Canvas, page: int) -> int:
    draw_bg(c, "Commercial & Risk Mechanics", page)
    y = TOP - 10 * mm
    y = para(c, "Commercial Hypothesis", MARGIN_X, y, PAGE_W - 2 * MARGIN_X, STYLE_H1)
    y = para(
        c,
        "Sayve is not selling record keeping. It is selling financial clarity: knowing what is happening, knowing nothing is out of control, and not needing to keep those worries in the user's head.",
        MARGIN_X,
        y,
        PAGE_W - 2 * MARGIN_X,
        STYLE_BODY,
    )
    y = bullets(
        c,
        [
            "Early users: couples and families managing shared household spending.",
            "Value driver: low-friction memory capture plus awareness, not manual budgeting.",
            "Moat: accumulated household memory graph - facts, context, relationships, corrections, custom categories, and recurring patterns.",
            "Pricing reality: finance-conscious users may be price-sensitive, so cost per household must be measured from day one.",
        ],
        MARGIN_X,
        y - 4 * mm,
        PAGE_W - 2 * MARGIN_X,
    )
    y = para(c, "Key Risks", MARGIN_X, y - 2 * mm, PAGE_W - 2 * MARGIN_X, STYLE_H2)
    y = bullets(
        c,
        [
            "Habit risk: if capture feels like work, users stop.",
            "Accuracy risk: if AI misclassifies too often, trust breaks.",
            "Cost risk: if every answer calls expensive AI, margin disappears.",
            "Privacy risk: household finance requires strict auth, redaction, and private source-file handling.",
            "Positioning risk: users may mistake Sayve for another bookkeeping app unless capture and conversation lead the product.",
        ],
        MARGIN_X,
        y,
        PAGE_W - 2 * MARGIN_X,
    )
    c.showPage()
    page += 1
    draw_bg(c, "V1 Success Criteria", page)
    y = TOP - 10 * mm
    y = para(c, "V1 Success Criteria", MARGIN_X, y, PAGE_W - 2 * MARGIN_X, STYLE_H1)
    bullets(
        c,
        [
            "Users naturally say: 我同 Sayve 講一聲就得.",
            "Capture does not feel like a form.",
            "AI can reliably create memory from text, receipt, and voice.",
            "Most captures do not require immediate back-and-forth.",
            "Users ask Sayve questions instead of manually searching records.",
            "Dashboard and timeline can be generated from memory without extra AI cost.",
            "Corrections improve future understanding.",
            "The system can support a small number of real households with controlled cost and privacy boundaries.",
        ],
        MARGIN_X,
        y,
        PAGE_W - 2 * MARGIN_X,
    )
    panel(c, MARGIN_X, 62 * mm, PAGE_W - 2 * MARGIN_X, 38 * mm, PANEL_2)
    para(
        c,
        "One-line definition: Sayve is a Family Financial Memory Companion that lets a household stop keeping books and simply tell AI what happened.",
        MARGIN_X + 8 * mm,
        52 * mm,
        PAGE_W - 2 * MARGIN_X - 16 * mm,
        STYLE_QUOTE,
    )
    c.showPage()
    return page + 1


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    make_crops()
    c = Canvas(str(PDF_PATH), pagesize=A4)
    add_cover(c)
    page = add_future_pages(c, 2)
    page = add_manifesto(c, page)
    page = add_mechanics(c, page)
    page = add_ui_pages(c, page)
    add_business(c, page)
    c.save()
    print(PDF_PATH)


if __name__ == "__main__":
    main()
