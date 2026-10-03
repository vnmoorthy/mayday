# Mayday deck

`Mayday.pptx` is the 10-slide pitch: black field, white type, honey accent,
16:9. It is generated, not hand-edited, so change the script and rebuild.

The animated version lives at https://mayday-alpha-eight.vercel.app/deck.

## Regenerate

```bash
pip install python-pptx==1.0.2   # once
python3 scripts/build_deck.py
```

Run it from the repo root. It writes `deck/Mayday.pptx`, then reopens the file
and checks it: 10 slides, a title and speaker notes on each, a fade transition
in the right place in every slide's XML, and no shape or text box outside the
slide. It prints one line per slide and exits non-zero if a check fails.

```bash
python3 scripts/build_deck.py --no-animations   # transitions only
```

Use `--no-animations` if a viewer has trouble with the entrance animations.
Every slide still gets its fade transition.

## What is in it

| # | Slide | Visual |
|---|---|---|
| 1 | Mayday: the stop signal for agents | a honeycomb: one red cell, honey neighbours, blue rescues |
| 2 | The honeybee | the forager's path, the hit, the stop signal spreading across the comb |
| 3 | The problem | three real errors, agents flying into the same red cell |
| 4 | The loop | four steps with arrows, lighting up in order |
| 5 | Live | the live URL, large (and the radar screenshot when it exists) |
| 6 | The vendor side | a ranked crash-site table with a pinned official fix |
| 7 | Airworthiness | the grade stepping C, B, A as honey cells fill in |
| 8 | How it's built | four columns: Supabase, Vercel, Stripe, Claude |
| 9 | The business | find, fix, prove |
| 10 | Close | the comb turning from red to blue |

## Notes

- Every visual is drawn with native shapes (hexagons are freeform paths), so
  the deck needs no image files and stays sharp at any size.
- Slide 5 uses `docs/screenshots/radar.png` inside a hairline frame when that
  file exists at build time. Without it the slide shows a large URL panel.
  The live numbers are not baked in: the slide says "live on screen" and the
  presenter switches to the site.
- Fonts are Helvetica Neue and Menlo. On a machine without them PowerPoint
  substitutes its own sans and mono.
- Speaker notes are in each slide's notes pane: about three minutes in total.
- Animations play on their own once a slide is up (no extra clicks), so one
  click still means one slide.
