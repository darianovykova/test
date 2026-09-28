# SEOspace dashboard — motion piece

A 27-second, seamlessly looping 1440×1440 motion piece built from the existing
SEOspace **Dashboard** screen (Figma `ANODA | Marketing - Work`, node `3353:82260`).
The screen is rebuilt 1:1 from the Figma layer data (Inter, the file's colour
tokens, exported icons, logo and avatar). Nothing is redesigned: all motion
happens on the real elements. The app window is the real 1440×900 viewport of
the Figma frame. The top bar and sidebar stay fixed, and the content area scrolls
to reach the Clicks chart below the fold.

| File | What it is |
|---|---|
| `seospace-dashboard-motion.html` | **Deliverable.** Self-contained single HTML file (font, images and script inlined). Open it to watch the live loop; `?t=12.5` freezes a moment. |
| `out/seospace-dashboard-motion.mp4` | Rendered video: 60 fps, 4-sub-frame motion blur, realistic mouse-click audio. |
| `index.html`, `motion.js`, `assets/` | Editable sources that the bundle is built from. |
| `render.mjs` | Playwright renderer (storyboard frames, video). |
| `synth.py` | Procedural mouse-click synthesiser (physical switch/shell model), driven by the cue sheet in `motion.js`. |
| `bundle.mjs` | Inlines sources into the single deliverable HTML. |

## Motion system

- `window.MOTION.seek(t)` is a pure function of time. It uses no CSS transitions, timers or
  stored animation state.
- Springs are closed-form step responses. The UI springs use ζ≈0.84, so overshoot is about 1%.
  The camera, cursor and counters are critically damped.
- A property that changes target several times is the **sum of independent spring responses**.
  This covers the camera, cursor, numbers, chart shapes and the tab indicator.
- During the chart scrub the tooltip is driven directly by the cursor position. The value
  snaps at the midpoint crossing of each cursor move.
- Content swaps (labels, table values, axis labels, dates) run an exit phase, then a separate
  enter phase, so the outgoing and incoming text never overlap.
- The timeline is a 120 BPM grid: 0.5 s per beat, 54 beats in total, starting on a downbeat.
  Clicks, data changes and scrub stops all land on beats.
- Scrolling is a spring on the content offset (0 ↔ 360 px). A macOS-style overlay scrollbar
  fades in only while scrolling. The Clicks chart draws itself as it scrolls into view.
- Audio is realistic interface sound only. Each of the 6 clicks is a mouse-button press on the
  beat plus a softer release 95 ms later, and each scroll has 7 wheel notches. Hovers, menus,
  data updates and scrubbing are silent, as they are in a real web app.
- The loop seam is the empty app shell with the cursor resting. The frame at t = 26.99 s is
  pixel-identical to the frame at t = 0.

## Storyboard (beats)

| Beats | What happens |
|---|---|
| 1–4 | The shell comes alive. Nav items stagger in, the slots bar fills, the header appears, then the cards rise in, with the stats row peeking in at the bottom of the viewport. |
| 5–10 | The data draws in. The health ring sweeps to 87 and 10,500 counts up. The traffic area chart draws, the trend chips pop in, and the recommendation rows, keyword and top-page tables and four stats count up. |
| 11–16 | The camera pushes in on the header. The cursor opens **Last month ▾** and picks **Last 7 days**. |
| 17–20 | The camera pulls out and every metric updates. The ring goes to 91, traffic to 2,640, the charts morph, and tables, stats, axis and dates all swap. |
| 21–28 | The camera zooms in on Organic Search Traffic. The cursor scrubs the chart, one day per beat, with a tooltip following it. |
| 29–32 | The cursor hovers each Recommended Next Steps row: the row tints and its chevron nudges. |
| 33–40 | The cursor wheel-scrolls down and the Clicks chart draws into view. The cursor clicks the **Total Impressions** tab. The selected surface slides over, the legend and axis swap, and the chart morphs. The cursor hovers the peak, then goes back to **Total Clicks**. |
| 41–48 | The cursor wheel-scrolls back up and picks **Last month** again. Every value returns to the original and the camera returns to the overview. |
| 49–54 | The content resolves back to the shell, which is the loop point. |

## Rebuild

```bash
npm install                 # playwright + Inter
npm run storyboard          # one PNG per beat → out/beats
npm run video               # frames → out/*.silent.mp4, clicks → out/ui_sounds.wav
node render.mjs events      # (audio only) re-export the cue sheet, then run synth.py
ffmpeg -i out/seospace-dashboard-motion.silent.mp4 -i out/ui_sounds.wav \
  -c:v copy -c:a aac -b:a 192k -shortest out/seospace-dashboard-motion.mp4
npm run bundle              # → seospace-dashboard-motion.html
```

Rendering needs `ffmpeg` built with `tmix` and `libx264`. The static build from the
`imageio-ffmpeg` pip package works.
