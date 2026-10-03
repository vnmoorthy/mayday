# Mayday deck

`Mayday.pptx` is the 10-slide pitch: honey-yellow field (#F6CF1B), near-black
bold type, pill labels, 16:9. It mirrors the web deck. It is generated, not
hand-edited, so change the script and rebuild.

The animated version lives at https://mayday-alpha-eight.vercel.app/deck.

## Regenerate

```bash
pip install python-pptx==1.0.2   # once
python3 scripts/build_deck.py
```

Run it from the repo root. It writes `deck/Mayday.pptx`, then reopens the file
and checks it: 10 slides, a title and speaker notes on each, a fade transition
in the right place in every slide's XML, a photograph on slides 1, 2 and 10,
no blue, and no shape or text box outside the slide. It prints one line per slide and exits non-zero if a check fails.

```bash
python3 scripts/build_deck.py --no-animations   # transitions only
```

Use `--no-animations` if a viewer has trouble with the entrance animations.
Every slide still gets its fade transition.

## What is in it

| # | Slide | Visual |
|---|---|---|
| 1 | Mayday: the stop signal for agents | the hero photograph (`public/art/hero-1600.jpg`) on the right, wordmark and pills on the left |
| 2 | The honeybee | the stop-signal photograph (`public/art/stop.jpg`) beside the two sentences |
| 3 | The problem | three real errors in the dark code panel, agents flying into the same red cell |
| 4 | The loop | four steps with arrows, lighting up in order |
| 5 | Live | four live counters, the test-flight line, the live URL, large |
| 6 | The vendor side | five points (incidents, AI-drafted official fixes) and a ranked crash-site table with a pinned official fix |
| 7 | Not just stop signals | STOP SIGNAL and WAGGLE DANCE columns, the vaccination line, the airworthiness pill |
| 8 | How it's built | five columns: Supabase, Vercel, Stripe, Claude, Google Gemini |
| 9 | The business | find, fix, prove |
| 10 | Close | the closing line on plain yellow, the comb photograph (`public/art/comb.jpg`) as a band along the bottom |

## Notes

- Colour is for data: deep red maydays (#B80F26), burnt honey official fixes
  (#7A3F00), pale wax rescued cells (#FFF6C2, dark outline). The only dark
  surface is the rounded code panel. No blue.
- Slides 1, 2 and 10 embed the photographs from `public/art`; every other
  visual is drawn with native shapes (hexagons are freeform paths).
- The live numbers are not baked in: slide 5 says "live on screen" and the
  presenter switches to the site. The deck claims no measured speed-up.
- Fonts are Helvetica Neue (bold headlines) and Menlo. On a machine without
  them PowerPoint substitutes its own sans and mono.
- Speaker notes are in each slide's notes pane, word for word from
  `components/deck/notes.ts`: about three minutes in total.
- Animations play on their own once a slide is up (no extra clicks), so one
  click still means one slide.
