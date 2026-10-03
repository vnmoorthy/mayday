#!/usr/bin/env python3
"""Builds deck/Mayday.pptx: the 10-slide Mayday pitch on a honey-yellow field.

Near-black bold type, pill labels, one dark surface (the code panel). Slides
1, 2 and 10 use the photographs in public/art; every other visual is drawn
with native shapes (hexagons are freeform paths). It mirrors the web deck in
components/deck/slides.tsx and takes its speaker notes from notes.ts.

    python3 scripts/build_deck.py                  # build and verify
    python3 scripts/build_deck.py --no-animations  # transitions only

Needs python-pptx (pip install python-pptx==1.0.2).
"""

import math
import sys
from pathlib import Path

from lxml import etree
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.dml import MSO_LINE
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE, MSO_SHAPE_TYPE
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "deck" / "Mayday.pptx"
ART = ROOT / "public" / "art"
SITE = "https://mayday-alpha-eight.vercel.app"
REPO = "https://github.com/vnmoorthy/mayday"
ANIMATE = "--no-animations" not in sys.argv

# Slide geometry, in inches. M is the page margin.
W, H, M = 13.333, 7.5, 0.75
CW = W - 2 * M
SQ3 = math.sqrt(3)

# Honey field, near-black type. Colour is for data: deep red maydays, burnt
# honey official fixes, pale wax (with a dark outline) rescues. No blue.
FIELD, INK, WAX = "F6CF1B", "17130D", "FFF6C2"
RED, HONEY, MUTE = "B80F26", "7A3F00", "54491A"
PANEL, LINE, SOFT = "F9DB4A", "D5B319", "CCB33E"
SANS, MONO = "Helvetica Neue", "Menlo"
FLIGHT = ("In a real test flight today, the first agent charted a new crash site and left a fix; "
          "the next agent got that fix from Mayday.")

P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"

# The final speaker notes, word for word from components/deck/notes.ts.
NOTES = [
    "This is Mayday, the stop signal for agents. We built it for Supabase Select, where the brief was to build something agents want. So for us, the agent is the customer.",
    "The idea comes from honeybees. When a forager is attacked at a flower, she flies home and gives her nestmates a stop signal: don't send anyone down that path. One bee pays, and the rest of the hive doesn't.",
    "Coding agents have nothing like that. Every day they hit the same Stripe webhook error, the same Supabase row-level security wall, the same Next.js params error. Each one pays for a fix another agent already found, and the vendor never hears about it.",
    "Here's the loop. An agent goes down and sends a mayday. Postgres matches the error to a crash site. The agent gets a briefing with the fixes that worked, official fix first. When it's flying again it confirms the rescue, and that makes the best fix rise.",
    "This is live. These numbers come straight from the production API, with charted sites marked. In a real test flight today, the first agent charted a new crash site and left a fix; the next agent got that fix from Mayday.",
    "There's a second customer: the vendor. Every vendor gets a tower, a ranked map of where agents crash on their product. Incidents are spikes detected against each site's own baseline. Official fixes are drafted by AI from the black boxes, reviewed by the vendor, pinned at the crash site, and paid for per rescue through Stripe.",
    "And it's not just stop signals. Bees also dance to share good routes. Agents ask Mayday for the proven route before they start, report a landing when it works, and chart new routes. The plugin also vaccinates: it briefs an agent on its project's stack before it writes a line. All of it feeds an airworthiness rating that can't be bought.",
    "Under the hood, Postgres does the matching, row-level security is the permission model, and Realtime drives the interface. It runs on Vercel with an MCP server. Stripe handles claiming and metered billing. Claude Code agents fly the test flights. Gemini drafts the official fixes and generated the artwork. A mayday is one SQL transaction.",
    "Vendors already spend heavily to stop developers failing on their products. Mayday lets them find the failures, fix them at the moment they happen, and prove it with a rating and a per-rescue bill. And it's useful on day one with no network: launch a test flight.",
    "Every agent that goes down should be the last one to go down there. That's Mayday. It's live, it's open source, and you can connect your agent today. Thank you.",
]

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(W), Inches(H)
STEPS = {}      # slide_id -> shape ids that fade in, in order
WARNINGS = []   # text that probably overflows its box


def rgb(hex_):
    return RGBColor.from_string(hex_)


# ---------------------------------------------------------------- primitives

def paint(shp, fill=None, line=None, lw=0.75, dash=False):
    """Flat fill and outline. Dropping p:style removes the theme's shadow."""
    style = shp._element.find(qn("p:style"))
    if style is not None:
        shp._element.remove(style)
    if hasattr(shp, "fill"):
        if fill:
            shp.fill.solid()
            shp.fill.fore_color.rgb = rgb(fill)
        else:
            shp.fill.background()
    if line:
        shp.line.color.rgb = rgb(line)
        shp.line.width = Pt(lw)
        if dash:
            shp.line.dash_style = MSO_LINE.DASH
    else:
        shp.line.fill.background()
    return shp


def hexagon(s, cx, cy, r, fill=None, line=None, lw=0.75):
    """A pointy-top hexagon, the same shape as the .hex clip-path in the app."""
    pts = [
        (Inches(cx + r * math.cos(math.radians(60 * i - 90))), Inches(cy + r * math.sin(math.radians(60 * i - 90))))
        for i in range(6)
    ]
    fb = s.shapes.build_freeform(pts[0][0], pts[0][1])
    fb.add_line_segments(pts[1:], close=True)
    return paint(fb.convert_to_shape(), fill, line, lw)


def polyline(s, pts, color, lw=0.75, dash=False):
    e = [(Inches(x), Inches(y)) for x, y in pts]
    fb = s.shapes.build_freeform(e[0][0], e[0][1])
    fb.add_line_segments(e[1:], close=False)
    return paint(fb.convert_to_shape(), None, color, lw, dash)


def rect(s, x, y, w, h, fill=None, line=None, lw=0.75):
    return paint(s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h)), fill, line, lw)


def rounded(s, x, y, w, h, fill=None, line=None, lw=0.75, radius=0.18):
    """A rounded rectangle; radius is in inches. radius >= h/2 makes a pill."""
    shp = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    shp.adjustments[0] = min(0.5, radius / min(w, h))
    return paint(shp, fill, line, lw)


def dot(s, cx, cy, r, fill):
    return paint(s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx - r), Inches(cy - r), Inches(2 * r), Inches(2 * r)), fill)


def rule(s, x1, y1, x2, y2, color=LINE, lw=0.75, arrow=False):
    c = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    paint(c, None, color, lw)
    if arrow:
        ln = c._element.spPr.find(qn("a:ln"))
        etree.SubElement(ln, qn("a:tailEnd"), type="triangle", w="med", len="med")
    return c


def char_w(font, bold, track):
    return (0.602 if font == MONO else 0.55 if bold else 0.5) + track


def text(s, x, y, w, h, paras, size=16, color=INK, font=SANS, track=0.0, align="l", anchor="t", line=1.0, gap=0,
         shape=None, bold=False):
    """A text box. paras is a string, or a list of paragraphs; a paragraph is a
    string or a list of (text, overrides) runs. track is letter spacing in em."""
    box = shape or s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    box.left, box.top, box.width, box.height = Inches(x), Inches(y), Inches(w), Inches(h)
    tf = box.text_frame
    tf.word_wrap = True
    tf.auto_size = MSO_AUTO_SIZE.NONE
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = {"t": MSO_ANCHOR.TOP, "m": MSO_ANCHOR.MIDDLE, "b": MSO_ANCHOR.BOTTOM}[anchor]
    if isinstance(paras, str):
        paras = [paras]
    need = 0.0
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = {"l": PP_ALIGN.LEFT, "r": PP_ALIGN.RIGHT, "c": PP_ALIGN.CENTER}[align]
        p.line_spacing = line
        if i and gap:
            p.space_before = Pt(gap)
        runs = [(para, {})] if isinstance(para, str) else para
        width_pt, biggest = 0.0, 0.0
        for t, o in runs:
            sz, fnt, tr, b = o.get("size", size), o.get("font", font), o.get("track", track), o.get("bold", bold)
            r = p.add_run()
            r.text = t
            r.font.size = Pt(sz)
            r.font.name = fnt
            r.font.bold = b
            r.font.color.rgb = rgb(o.get("color", color))
            if tr:
                r._r.get_or_add_rPr().set("spc", str(int(round(tr * sz * 100))))
            width_pt += len(t) * sz * char_w(fnt, b, tr)
            biggest = max(biggest, sz)
        # Rough fit check: wrapped lines times line height against the box.
        lines = max(1, math.ceil(width_pt * 1.08 / (w * 72)))
        need += (lines * biggest * 1.2 * line + (gap if i else 0)) / 72
    if need > h + 0.04:
        WARNINGS.append(f"text may overflow ({need:.2f}in needed, {h:.2f}in box): {str(paras)[:60]}")
    return box


def pill_w(label, size=9, track=0.16, font=MONO, bold=False, pad=0.18, mark=None):
    return len(label) * size * char_w(font, bold, track) / 72 * 1.12 + 2 * pad + (0.24 if mark else 0)


def pill(s, x, y, label, dark=False, size=9, h=0.34, track=0.16, font=MONO, bold=False, pad=0.18, mark=None, color=None):
    """A pill label: outlined on the field, or near-black with pale text.
    mark is the colour of a small hexagon before the text. Returns (shapes, width)."""
    w = pill_w(label, size, track, font, bold, pad, mark)
    parts = [rounded(s, x, y, w, h, INK if dark else None, None if dark else INK, 1.5, radius=h / 2)]
    off = pad
    if mark:
        parts.append(hexagon(s, x + pad + 0.07, y + h / 2, 0.075, mark))
        off += 0.24
    parts.append(text(s, x + off, y, w - off - pad, h, label, size=size, color=color or (WAX if dark else INK),
                      font=font, track=track, bold=bold, anchor="m"))
    return parts, w


def picture(s, path, x, y, w, h, align="c", line=None, radius=None):
    """A photograph cropped to cover the box. x, y, w, h are EMU, so an edge can
    sit exactly on the slide edge."""
    pic = s.shapes.add_picture(str(path), 0, 0)
    ir, br = pic.width / pic.height, w / h
    if ir > br:
        cut = 1 - br / ir
        left = {"l": 0.0, "c": cut / 2, "r": cut}[align]
        pic.crop_left, pic.crop_right = left, cut - left
    else:
        cut = 1 - ir / br
        pic.crop_top = pic.crop_bottom = cut / 2
    pic.left, pic.top, pic.width, pic.height = x, y, w, h
    if radius is not None:
        pic.auto_shape_type = MSO_SHAPE.ROUNDED_RECTANGLE
        geom = pic._element.spPr.find(qn("a:prstGeom"))
        av = geom.find(qn("a:avLst"))
        if av is None:
            av = etree.SubElement(geom, qn("a:avLst"))
        for child in list(av):
            av.remove(child)
        etree.SubElement(av, qn("a:gd"), name="adj", fmla=f"val {int(radius * 100000)}")
    if line:
        pic.line.color.rgb = rgb(line)
        pic.line.width = Pt(2)
    return pic


def step(s, shapes):
    """Group shapes into one unit that fades in as the next animation step."""
    g = s.shapes.add_group_shape([x for x in shapes if x is not None])
    STEPS.setdefault(s.slide_id, []).append(g.shape_id)
    return g


def comb(n):
    """Axial coordinates of a hexagonal comb of radius n, with each cell's ring."""
    for q in range(-n, n + 1):
        for r in range(max(-n, -q - n), min(n, -q + n) + 1):
            yield q, r, max(abs(q), abs(r), abs(q + r))


def cell_xy(cx, cy, R, q, r):
    return cx + R * SQ3 * (q + r / 2), cy + R * 1.5 * r


def slide(n, section, chrome=True):
    s = prs.slides.add_slide(prs.slide_layouts[5])  # Title Only: keeps a real title for outline view
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = rgb(FIELD)
    s.notes_slide.notes_text_frame.text = NOTES[n - 1]
    if chrome:
        # Section pill top left, slide counter top right, a quiet footer.
        pill(s, M, 0.42, section, mark=INK)
        text(s, W - M - 3, 0.5, 3, 0.2, f"{n:02d} / 10", size=10, color=MUTE, font=MONO, track=0.16, align="r")
        rule(s, M, 6.88, W - M, 6.88, LINE)
        text(s, M, 7.0, 6, 0.18, "MAYDAY  ·  THE STOP SIGNAL FOR AGENTS", size=8.5, color=MUTE, font=MONO, track=0.16)
        text(s, W - M - 6, 7.0, 6, 0.18, SITE.replace("https://", ""), size=8.5, color=MUTE, font=MONO, track=0.04, align="r")
    return s


def title(s, paras, x, y, w, h, size=54, color=INK, track=-0.035, line=0.9):
    return text(s, x, y, w, h, paras, size=size, color=color, track=track, line=line, shape=s.shapes.title, bold=True)


# -------------------------------------------------------------------- slides

def s01_title():
    s = slide(1, "TITLE", chrome=False)
    # The hero photograph fills the right 55% at full height.
    pw = Inches(7.333)
    picture(s, ART / "hero-1600.jpg", prs.slide_width - pw, 0, pw, prs.slide_height, align="r")
    pill(s, M, 1.55, "SUPABASE SELECT 2026 HACKATHON", mark=INK)
    title(s, "Mayday", M, 2.1, 5.2, 1.6, size=100, track=-0.045, line=0.85)
    text(s, M, 3.95, 5.2, 1.25, ["The stop signal", "for agents."], size=36, bold=True, track=-0.03, line=0.95)
    x = M
    for name in ("STOP SIGNAL", "WAGGLE DANCE", "VACCINATION"):
        _, w = pill(s, x, 5.5, name, dark=True, pad=0.16)
        x += w + 0.12


def s02_honeybee():
    s = slide(2, "THE HONEYBEE")
    title(s, "A honeybee attacked at a flower warns the hive off that path.", M, 1.7, 4.9, 2.6, size=36)
    text(s, M, 4.6, 4.9, 1.0, "One bee pays. The hive doesn't.", size=26, color=HONEY, bold=True, track=-0.03)
    ix = Inches(6.0)
    picture(s, ART / "stop.jpg", ix, Inches(1.45), prs.slide_width - Inches(M) - ix, Inches(4.9), line=INK, radius=0.07)
    step(s, pill(s, 6.25, 5.75, "THE STOP SIGNAL", dark=True, mark=RED)[0])


def s03_problem():
    s = slide(3, "THE PROBLEM")
    title(s, "Agents have no stop signal.", M, 1.25, 7.3, 1.75, size=54)
    walls = [
        ("STRIPE WEBHOOKS", "No signatures found matching the expected signature for payload"),
        ("SUPABASE", "new row violates row-level security policy"),
        ("NEXT.JS", "params should be awaited before using its properties"),
    ]
    # The one dark surface: a terminal panel for the real error lines.
    rounded(s, M, 3.2, 7.3, 2.35, INK, None, radius=0.22)
    for i, (vendor, err) in enumerate(walls):
        y0 = 3.43 + i * 0.68
        text(s, M + 0.3, y0, 0.2, 0.22, "!", size=11, color=FIELD, font=MONO)
        text(s, M + 0.6, y0, 6.5, 0.22, err, size=11, color=WAX, font=MONO)
        text(s, M + 0.6, y0 + 0.27, 6.5, 0.18, vendor, size=8, color=FIELD, font=MONO, track=0.16)
    text(s, M, 5.8, 7.3, 0.85, "Every agent pays again. The vendor never finds out.", size=22, color=HONEY, bold=True, track=-0.03)

    # A comb with one red crash site, and agent after agent flying into it.
    cx, cy, R = 10.75, 3.7, 0.4
    for q, r, ring in comb(2):
        hexagon(s, *cell_xy(cx, cy, R, q, r), R * 0.92, RED if ring == 0 else PANEL, None if ring == 0 else INK, 0.75)
    for deg in (180, 225, 135, 270, 90, 0):
        a = math.radians(deg)
        step(s, [dot(s, cx + d * math.cos(a), cy + d * math.sin(a), 0.04 + 0.012 * k, INK)
                 for k, d in enumerate((1.9, 1.5, 1.1, 0.7))])
    text(s, 9.0, 5.95, 3.5, 0.2, "DOWN AT THE SAME SITE", size=9, color=MUTE, font=MONO, track=0.16, align="c")


def s04_loop():
    s = slide(4, "THE LOOP")
    title(s, "The loop.", M, 1.25, CW, 0.85, size=48)
    gap = 0.3
    cw = (CW - 3 * gap) / 4
    steps = [
        (RED, None, RED, [("Agent goes down → ", {}), ("mayday", {"color": RED})]),
        (INK, None, INK, [("Postgres finds the crash site", {})]),
        (HONEY, None, HONEY, [("Briefing: the fix that worked, ", {}), ("official fix first", {"color": HONEY})]),
        (WAX, INK, INK, [("Rescue confirmed, the best fix rises", {})]),
    ]
    for i, (fill, line, num, runs) in enumerate(steps):
        x = M + i * (cw + gap)
        parts = [hexagon(s, x + 0.45, 2.85, 0.45, fill, line, 1.5)]
        if i < 3:
            parts.append(rule(s, x + 1.05, 2.85, x + cw + gap - 0.12, 2.85, INK, 1.5, arrow=True))
        parts += [
            text(s, x, 3.5, 1.5, 1.1, str(i + 1), size=72, color=num, bold=True, track=-0.04, line=0.9),
            text(s, x, 4.75, cw - 0.1, 1.7, [runs], size=20, bold=True, track=-0.02, line=1.05),
        ]
        step(s, parts)


def s05_live():
    s = slide(5, "LIVE")
    title(s, "Watch one go down.", M, 1.2, 8.6, 1.05, size=58)
    dot(s, M + 8.25, 1.75, 0.11, RED)
    gap = 0.25
    cw = (CW - 3 * gap) / 4
    for i, label in enumerate(["TOTAL MAYDAYS", "RESCUES", "CRASH SITES", "VENDORS"]):
        x = M + i * (cw + gap)
        rounded(s, x, 2.5, cw, 1.3, PANEL, LINE, radius=0.2)
        text(s, x + 0.25, 2.7, cw - 0.5, 0.18, label, size=8.5, color=MUTE, font=MONO, track=0.16)
        text(s, x + 0.25, 3.02, cw - 0.5, 0.5, "live on screen", size=20, color=RED if i == 0 else INK, bold=True, track=-0.03)
    _, w = pill(s, M, 4.05, "GET /api/v1/map", dark=True, track=0.02)
    text(s, M + w + 0.2, 4.05, 8, 0.34, "INCLUDES CHARTED SITES; LIVE AND TEST-FLIGHT TRAFFIC IS MARKED",
         size=8.5, color=MUTE, font=MONO, track=0.12, anchor="m")
    text(s, M, 4.6, CW, 0.75, FLIGHT, size=17, bold=True, track=-0.015, line=1.1)
    pill(s, M, 5.6, SITE.replace("https://", ""), dark=True, size=28, h=0.85, track=-0.02, font=SANS, bold=True,
         pad=0.4, color=FIELD)


def s06_vendor():
    s = slide(6, "THE VENDOR SIDE")
    title(s, "Every vendor gets a tower.", M, 1.25, 5.4, 1.5, size=44)
    points = [
        (INK, "See where agents crash on your product, ranked by agents down and hours lost"),
        (RED, "Incidents: spikes detected against each site's own baseline"),
        (HONEY, "Official fixes drafted by AI from the black boxes, reviewed by the vendor"),
        (INK, "Pin the official fix at the exact crash site"),
        (INK, "Pay per rescue, through Stripe. Only when the fix works."),
    ]
    for i, (color, p) in enumerate(points):
        y0 = 3.0 + i * 0.72
        hexagon(s, M + 0.1, y0 + 0.13, 0.09, color)
        text(s, M + 0.4, y0, 5.0, 0.6, p, size=14, track=-0.01, line=1.05)

    # The tower, sketched: crash sites ranked, bars for agents down and hours lost.
    tx, ty, tw, th = 6.55, 1.45, W - M - 6.55, 5.1
    rounded(s, tx, ty, tw, th, PANEL, LINE, radius=0.25)
    for label, off in [("#", 0.3), ("CRASH SITE", 0.8), ("AGENTS DOWN", 3.55), ("HOURS LOST", 4.8)]:
        text(s, tx + off, ty + 0.25, 1.2, 0.16, label, size=7.5, color=MUTE, font=MONO, track=0.12)
    names, down, lost = [1.35, 2.1, 1.8, 2.3, 1.6], [1.0, 0.8, 0.58, 0.4, 0.24], [0.8, 0.56, 0.45, 0.27, 0.18]
    for i in range(5):
        y0 = ty + 0.6 + i * 0.86
        rule(s, tx + 0.25, y0, tx + tw - 0.25, y0, LINE)
        text(s, tx + 0.3, y0 + 0.3, 0.4, 0.2, str(i + 1), size=11, color=MUTE, font=MONO)
        rect(s, tx + 0.8, y0 + 0.28, names[i], 0.1, SOFT)
        rect(s, tx + 0.8, y0 + 0.52, 0.6, 0.06, SOFT)
        rect(s, tx + 3.55, y0 + 0.36, down[i], 0.1, RED)
        rect(s, tx + 4.8, y0 + 0.36, lost[i], 0.1, INK)
    y0 = ty + 0.6
    step(s, [
        rect(s, tx + 0.12, y0 + 0.12, 0.06, 0.62, HONEY),
        hexagon(s, tx + 1.62, y0 + 0.55, 0.06, HONEY),
        text(s, tx + 1.75, y0 + 0.485, 1.4, 0.14, "OFFICIAL FIX", size=7.5, color=HONEY, font=MONO, track=0.1, bold=True),
    ])


def s07_signals():
    s = slide(7, "NOT JUST STOP SIGNALS")
    title(s, "Not just stop signals.", M, 1.2, 7.3, 0.85, size=42)
    air = "AIRWORTHINESS · THE RATING THAT CAN'T BE BOUGHT"
    pill(s, W - M - pill_w(air, 7.5, 0.1, mark=HONEY), 1.45, air, size=7.5, track=0.1, mark=HONEY)
    signals = [
        ("STOP SIGNAL", "Don't go down that path.", RED, [
            "Maydays: an agent goes down and says where",
            "Crash sites: the same failure, matched and counted",
            "Rescues: the fix that worked, confirmed by the agent it saved",
        ]),
        ("WAGGLE DANCE", "Fly this way instead.", HONEY, [
            "Proven routes: agents ask for the known good path before they start",
            "Landings: they report when the route got them there",
            "New routes: they chart the ones nobody has flown yet",
        ]),
    ]
    gap, y, h = 0.3, 2.25, 3.3
    cw = (CW - gap) / 2
    for i, (name, line, color, points) in enumerate(signals):
        x = M + i * (cw + gap)
        parts = [rounded(s, x, y, cw, h, PANEL, LINE, radius=0.28)]
        parts += pill(s, x + 0.3, y + 0.28, name, dark=True, mark=RED if i == 0 else FIELD)[0]
        parts.append(text(s, x + 0.3, y + 0.8, 3.8, 0.5, line, size=20, color=color, bold=True, track=-0.03))
        vx, vy = x + cw - 0.9, y + 0.75
        if i == 0:
            # One red cell, ringed by rescued cells in pale wax.
            for q, r, ring in comb(1):
                parts.append(hexagon(s, *cell_xy(vx, vy, 0.2, q, r), 0.184, RED if ring == 0 else WAX,
                                     None if ring == 0 else INK, 0.75))
        else:
            # The waggle dance: a loop with a zigzag run up the middle.
            k = 1.4 / 174
            loop = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(vx - 0.7), Inches(vy - 0.36), Inches(1.4), Inches(0.72))
            parts.append(paint(loop, None, HONEY, 2.25))
            run = [(117, 118), (107, 104), (127, 90), (107, 76), (127, 62), (107, 48), (117, 32)]
            parts.append(polyline(s, [(vx + (px - 117) * k, vy + (py - 75) * k) for px, py in run], INK, 2.25))
        for j, p in enumerate(points):
            y0 = y + 1.55 + j * 0.56
            parts.append(hexagon(s, x + 0.4, y0 + 0.12, 0.08, color))
            parts.append(text(s, x + 0.65, y0, cw - 0.95, 0.5, p, size=13, track=-0.01, line=1.05))
        step(s, parts)
    _, w = pill(s, M, 5.85, "VACCINATION")
    text(s, M + w + 0.25, 5.85, CW - w - 0.25, 0.34,
         "The plugin briefs an agent on its project's stack before it writes a line.",
         size=15, bold=True, track=-0.015, anchor="m")


def s08_built():
    s = slide(8, "HOW IT'S BUILT")
    title(s, "How it's built.", M, 1.2, CW, 0.9, size=48)
    cols = [
        ("SUPABASE", ["Postgres does the matching (pg_trgm + error codes).", "RLS is the permission model.", "Realtime is the UI."]),
        ("VERCEL", ["Next.js 16, the MCP server, deploys in seconds."]),
        ("STRIPE", ["Checkout to claim an airspace.", "Billing Meters for pay-per-rescue."]),
        ("CLAUDE", ["Claude Code plugin hook, the MCP tools, test flights flown by real agents."]),
        ("GOOGLE GEMINI", ["Drafts official fixes and generated the artwork."]),
    ]
    gap = 0.3
    cw = (CW - 4 * gap) / 5
    for i, (name, body) in enumerate(cols):
        x = M + i * (cw + gap)
        last = i == len(cols) - 1
        step(s, [
            rule(s, x, 2.55, x + cw, 2.55, INK, 2.0),
            hexagon(s, x + 0.1, 2.88, 0.09, HONEY if last else INK),
            text(s, x + 0.3, 2.79, cw - 0.3, 0.2, name, size=10, font=MONO, track=0.14, bold=True),
            text(s, x, 3.3, cw, 2.3, body, size=13, color=MUTE if last else INK, track=-0.01, line=1.05, gap=6),
        ])
    pill(s, M, 5.85, "A mayday is one SQL transaction.", dark=True, size=12, h=0.46, track=0.02, pad=0.3)


def s09_business():
    s = slide(9, "THE BUSINESS")
    title(s, "Vendors already pay to stop developers failing on their product.", M, 1.2, CW, 1.45, size=40)
    rows = [
        ("Find", "test flights + live maydays", RED, None),
        ("Fix", "the official fix, delivered at the moment of failure", HONEY, None),
        ("Prove", "airworthiness and a per-rescue bill", WAX, INK),
    ]
    rule(s, M + 0.28, 3.3, M + 0.28, 4.9, SOFT, 1.5)
    for i, (verb, rest, fill, line) in enumerate(rows):
        y0 = 2.95 + i * 0.8
        step(s, [
            hexagon(s, M + 0.28, y0 + 0.35, 0.27, fill, line, 1.5),
            text(s, M + 0.85, y0 + 0.08, 1.9, 0.55, verb, size=30, bold=True, track=-0.03),
            text(s, M + 2.9, y0 + 0.16, CW - 2.9, 0.42, rest, size=20, color=MUTE, track=-0.015),
        ])
    text(s, M, 5.6, CW, 0.5, "Day-one value with zero network: launch a test flight.", size=24, color=HONEY, bold=True, track=-0.03)


def s10_close():
    s = slide(10, "CLOSE", chrome=False)
    # The comb photograph as a band across the bottom third; the words stay on plain yellow.
    band = Inches(2.5)
    picture(s, ART / "comb.jpg", 0, prs.slide_height - band, prs.slide_width, band)
    rule(s, 0, 5.0, W, 5.0, INK, 2.0)
    pill(s, M, 0.7, "MAYDAY", dark=True, mark=FIELD)
    title(s, "Every agent that goes down should be the last one to go down there.", M, 1.3, CW, 1.6, size=44)
    pill(s, M, 3.3, SITE, dark=True, size=18, h=0.58, track=0, bold=True, pad=0.3, color=FIELD)
    pill(s, M, 4.05, REPO, size=18, h=0.58, track=0, bold=True, pad=0.3)


# --------------------------------------------------------- motion (raw XML)

def add_motion(s):
    """Fade transition on every slide, plus the fade-in steps that play on their
    own once the slide is up. The XML mirrors what PowerPoint writes itself."""
    sld = s._element
    anchor = sld.find(qn("p:clrMapOvr"))
    transition = etree.fromstring(f'<p:transition xmlns:p="{P_NS}" spd="med"><p:fade/></p:transition>')
    anchor.addnext(transition)  # schema order: clrMapOvr, transition, timing
    ids = STEPS.get(s.slide_id, [])
    if not ANIMATE or not ids:
        return
    n, t, pars = 3, 0, []
    wait, dur = 350, 500
    for spid in ids:
        pars.append(
            f'<p:par><p:cTn id="{n + 1}" fill="hold"><p:stCondLst><p:cond delay="{t}"/></p:stCondLst><p:childTnLst>'
            f'<p:par><p:cTn id="{n + 2}" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" nodeType="afterEffect">'
            f'<p:stCondLst><p:cond delay="{wait}"/></p:stCondLst><p:childTnLst>'
            f'<p:set><p:cBhvr><p:cTn id="{n + 3}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>'
            f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>'
            f'</p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>'
            f'<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="{n + 4}" dur="{dur}"/>'
            f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl></p:cBhvr></p:animEffect>'
            f'</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>'
        )
        n += 4
        t += wait + dur
    timing = etree.fromstring(
        f'<p:timing xmlns:p="{P_NS}"><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">'
        f'<p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>'
        f'<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/>'
        f'<p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst>'
        f'{"".join(pars)}'
        f'</p:childTnLst></p:cTn></p:par>'
        f'</p:childTnLst></p:cTn>'
        f'<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
        f'<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>'
        f'</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'
    )
    transition.addnext(timing)


# -------------------------------------------------------------------- verify

def walk(shapes):
    for shp in shapes:
        yield shp
        if shp.shape_type is not None and hasattr(shp, "shapes"):
            yield from walk(shp.shapes)


def verify(path):
    deck = Presentation(str(path))
    assert len(deck.slides) == 10, f"expected 10 slides, got {len(deck.slides)}"
    sw, sh = deck.slide_width, deck.slide_height
    problems = []
    for i, s in enumerate(deck.slides, 1):
        head = s.shapes.title.text_frame.text
        notes = s.notes_slide.notes_text_frame.text
        kids = [etree.QName(c).localname for c in s._element]
        assert "transition" in kids, f"slide {i}: no transition"
        assert kids.index("transition") == kids.index("clrMapOvr") + 1, f"slide {i}: transition misplaced"
        if "timing" in kids:
            assert kids.index("timing") == kids.index("transition") + 1, f"slide {i}: timing misplaced"
        assert notes.strip(), f"slide {i}: no speaker notes"
        xml = etree.tostring(s._element).decode().upper()
        assert "58B7FF" not in xml and "0000FF" not in xml, f"slide {i}: blue found"
        boxes, pics = 0, 0
        for shp in walk(s.shapes):
            if shp.shape_type == MSO_SHAPE_TYPE.PICTURE:
                pics += 1
            if shp.left < 0 or shp.top < 0 or shp.left + shp.width > sw or shp.top + shp.height > sh:
                problems.append(f"slide {i}: '{shp.name}' leaves the slide")
            if shp.has_text_frame and shp.text_frame.text.strip():
                boxes += 1
        steps = len(s._element.findall(".//" + qn("p:animEffect")))
        assert pics == (1 if i in (1, 2, 10) else 0), f"slide {i}: expected a photograph on slides 1, 2 and 10 only"
        print(f"{i:>2}  {head[:50]:<50}  notes {len(notes):>3} chars  text boxes {boxes:>2}  photos {pics}  fade-ins {steps}")
    words = sum(len(s.notes_slide.notes_text_frame.text.split()) for s in deck.slides)
    print(f"speaker notes: {words} words, about {words / 150:.1f} minutes spoken")
    for p in problems + WARNINGS:
        print("WARNING:", p)
    assert not problems, "shapes extend beyond the slide"
    print(f"ok: {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB), 10 slides, all text inside the slide")


def main():
    master_bg = prs.slide_master.background.fill
    master_bg.solid()
    master_bg.fore_color.rgb = rgb(FIELD)
    for build in (s01_title, s02_honeybee, s03_problem, s04_loop, s05_live, s06_vendor, s07_signals, s08_built, s09_business, s10_close):
        build()
    for s in prs.slides:
        add_motion(s)
    prs.core_properties.title = "Mayday: the stop signal for agents"
    prs.core_properties.author = "Mayday"
    prs.core_properties.subject = "Supabase Select 2026 hackathon"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(OUT))
    verify(OUT)


if __name__ == "__main__":
    main()
