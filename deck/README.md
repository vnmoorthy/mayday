# Pioneer deck

`Pioneer.pptx` is the 10-slide pitch: honey-yellow field (#F6CF1B), near-black
bold type, pill labels, 16:9. It mirrors the web deck. It is generated, not
hand-edited, so change the script and rebuild.

The animated version lives at https://mayday-alpha-eight.vercel.app/deck.

## Regenerate

```bash
pip install python-pptx==1.0.2   # once
python3 scripts/build_deck.py
```

Run it from the repo root. It writes `deck/Pioneer.pptx`, then reopens the file
and checks it: 10 slides, a title on each, speaker notes that match
`components/deck/notes.ts` word for word, a fade transition in the right place
in every slide's XML, a photograph on slides 1, 2 and 10, no blue, no shape or
text box outside the slide, and the old product name nowhere but the site's
host name. It prints one line per slide and exits non-zero if a check fails.

```bash
python3 scripts/build_deck.py --no-animations   # transitions only
```

Use `--no-animations` if a viewer has trouble with the entrance animations.
Every slide still gets its fade transition.

## What is in it

| # | Slide | Visual |
|---|---|---|
| 1 | Pioneer: the stop signal for agents | the hero photograph (`public/art/hero-1600.jpg`) on the right, wordmark and pills on the left |
| 2 | The honeybee | the stop-signal photograph (`public/art/stop.jpg`) beside the two sentences |
| 3 | The honest problem | a timeline with the training cutoff, and three things no model can know lighting up after it |
| 4 | The proof | 7 refused calls flying alone against 0 after asking Pioneer for the route |
| 5 | Live | the two flights in the dark panel, the `/live` URL, large, and the "Launch both" button |
| 6 | How an agent uses it | four steps from stop signal to rescue, lighting up in order, then "or ask first" |
| 7 | The vendor side | four points and a sketched tower: ranked crash sites with a pinned fix |
| 8 | Trust | four points beside what the agent receives: the untrusted envelope, a redaction, a rejected fix |
| 9 | How it's built | the request path as a diagram, then five columns: Supabase, Vercel, Stripe, Claude, Gemini |
| 10 | Close | the closing line on plain yellow, the comb photograph (`public/art/comb.jpg`) as a band along the bottom |

## Notes

- Colour is for data: deep red stop signals (#B80F26), burnt honey official fixes
  (#7A3F00), pale wax rescued cells (#FFF6C2, dark outline). The only dark
  surface is the rounded terminal panel. No blue.
- Slides 1, 2 and 10 embed the photographs from `public/art`; every other
  visual is drawn with native shapes (hexagons are freeform paths).
- Slide 4's numbers (7, 0, and Claude's 6 versus 0) were measured on October 3,
  2026, one flight each: a demonstration, not a benchmark. The live scoreboard
  is not baked in: the slide points to `/live` and the presenter switches to
  the site on slide 5.
- Fonts are Helvetica Neue (bold headlines) and Menlo. On a machine without
  them PowerPoint substitutes its own sans and mono.
- Section labels and speaker notes are read from `components/deck/notes.ts`
  when the script runs, so they match the web deck word for word: about three
  minutes in total.
- Animations play on their own once a slide is up (no extra clicks), so one
  click still means one slide.
