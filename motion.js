/* SEOspace dashboard — deterministic motion.
 * Every visual property is a pure function of time t (seconds) via seek(t).
 * Springs are closed-form step responses; a property that changes target several
 * times is the sum of independent spring responses. No timers, transitions or
 * mutable animation state (the only caches below are for DOM-write dedupe). */
(() => {
'use strict';

// ---------------------------------------------------------------- beat grid
const BPM = 120, BEAT = 60 / BPM, T = 27;       // 54 beats, loop starts on a downbeat
const beat = n => (n - 1) * BEAT;               // beat 1 → 0s

// ---------------------------------------------------------------- springs
const TAU = Math.PI * 2;
function spring(t, f, z) {                      // unit step response, f in Hz
  if (t <= 0) return 0;
  const w = TAU * f;
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
  }
  const x = w * t;
  return 1 - Math.exp(-x) * (1 + x);
}
const S = {
  ui:    t => spring(t, 2.3, 0.84),   // UI elements: tiny overshoot (~1%)
  pop:   t => spring(t, 2.6, 0.72),   // chips: slightly livelier, still < 4%
  out:   t => spring(t, 2.4, 1),      // exits: no overshoot
  fast:  t => spring(t, 5.0, 1),      // hover fades
  press: t => spring(t, 8.0, 1),      // click press
  cur:   t => spring(t, 1.9, 1),      // cursor travel
  curSlow: t => spring(t, 1.1, 1),    // cursor drifting home
  cam:   t => spring(t, 0.95, 1),     // camera
  count: t => spring(t, 0.95, 1),     // number counters (monotonic)
  ring:  t => spring(t, 0.85, 0.92),
  draw:  t => spring(t, 0.8, 1),      // chart line draw-in
  morph: t => spring(t, 1.5, 0.9),    // chart shape changes
  close: t => spring(t, 4.2, 1),      // menu close
};
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;

// scalar track: value = v0 + Σ (v_i − v_{i−1})·S(t − t_i)
function track(t, v0, steps, sp) {
  let v = v0, prev = v0;
  for (const [ti, vi] of steps) { v += (vi - prev) * sp(t - ti); prev = vi; }
  return v;
}
// vector track (arrays of numbers)
function vtrack(t, v0, steps, sp) {
  const out = v0.slice(); let prev = v0;
  for (const [ti, vi] of steps) {
    const k = sp(t - ti);
    if (k !== 0) for (let j = 0; j < out.length; j++) out[j] += (vi[j] - prev[j]) * k;
    prev = vi;
  }
  return out;
}
// on/off windows → smooth 0..1
function windows(t, list, sp = S.fast) {
  let v = 0;
  for (const [a, b] of list) v += sp(t - a) - sp(t - b);
  return clamp(v, 0, 1.2);
}
// entrance + exit
function life(t, tin, tout, spIn = S.ui, spOut = S.out) {
  const e = spIn(t - tin), x = tout == null ? 0 : spOut(t - tout);
  return { e, x, op: clamp(e) * (1 - clamp(x)) };
}
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, k) => { const A = hex(a), B = hex(b); return `rgb(${A.map((c, i) => Math.round(lerp(c, B[i], k))).join(',')})`; };

// ---------------------------------------------------------------- DOM helpers
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const cache = new WeakMap();
function css(el, prop, val) {
  let c = cache.get(el); if (!c) cache.set(el, c = {});
  if (c[prop] !== val) { el.style[prop] = val; c[prop] = val; }
}
function txt(el, s) {
  let c = cache.get(el); if (!c) cache.set(el, c = {});
  if (c.__t !== s) { el.textContent = s; c.__t = s; }
}
function setT(el, x, y, s = 1) { css(el, 'transform', `translate(${x.toFixed(3)}px,${y.toFixed(3)}px)` + (s !== 1 ? ` scale(${s.toFixed(5)})` : '')); }
function vis(el, op) { css(el, 'opacity', op.toFixed(4)); css(el, 'visibility', op < 0.002 ? 'hidden' : 'visible'); }
function attr(el, a, v) {
  let c = cache.get(el); if (!c) cache.set(el, c = {});
  if (c['@' + a] !== v) { el.setAttribute(a, v); c['@' + a] = v; }
}
function blur(el, b) { css(el, 'filter', b > 0.05 ? `blur(${b.toFixed(2)}px)` : 'none'); }

// Content swap with independent exit → enter (never overlapping).
const SW_OUT = 0.13;
function swap(t, el, items, dy = 7) {
  // items: [[time, text | fn(t)], ...], items[0][0] = -Infinity
  let i = 0; while (i + 1 < items.length && t >= items[i + 1][0]) i++;
  const val = (k, tt) => typeof items[k][1] === 'function' ? items[k][1](tt) : items[k][1];
  const ti = items[i][0];
  if (i > 0 && t < ti + SW_OUT) {                       // outgoing
    const p = (t - ti) / SW_OUT, e = p * p;
    txt(el, val(i - 1, ti)); css(el, 'opacity', (1 - e).toFixed(4));
    setT(el, 0, -dy * e); blur(el, 3 * e);
  } else {                                              // incoming (or initial)
    const p = i === 0 ? 1 : S.ui(t - ti - SW_OUT);
    txt(el, val(i, t)); css(el, 'opacity', clamp(p).toFixed(4));
    setT(el, 0, dy * (1 - p)); blur(el, 3 * clamp(1 - p));
  }
}

// ---------------------------------------------------------------- charts
function mono(xs, ys) {                                 // Fritsch–Carlson tangents
  const n = xs.length, d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const s = 3 / Math.sqrt(h); m[i] = s * a * d[i]; m[i + 1] = s * b * d[i]; }
  }
  return m;
}
function curvePath(xs, ys) {
  const m = mono(xs, ys); let p = `M${xs[0].toFixed(2)},${ys[0].toFixed(2)}`;
  for (let i = 0; i < xs.length - 1; i++) {
    const h = (xs[i + 1] - xs[i]) / 3;
    p += `C${(xs[i] + h).toFixed(2)},${(ys[i] + m[i] * h).toFixed(2)} ${(xs[i + 1] - h).toFixed(2)},${(ys[i + 1] - m[i + 1] * h).toFixed(2)} ${xs[i + 1].toFixed(2)},${ys[i + 1].toFixed(2)}`;
  }
  return p;
}
function curveY(xs, ys, x) {
  const m = mono(xs, ys); let i = 0;
  if (x <= xs[0]) return ys[0]; if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  while (x > xs[i + 1]) i++;
  const h = xs[i + 1] - xs[i], s = (x - xs[i]) / h, s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * h * m[i + 1];
}

// Organic Search Traffic — "Last month" is the Figma vector; "Last 7 days" is 13 half-day samples.
const O_LM_X = [0, 37.409, 61.858, 92.457, 119.060, 154.273, 182.259, 211.168, 237.001, 266.062, 285.129, 304.198, 311.381].map(x => x + 0.311);
const O_LM_Y = [96.534, 82.824, 58.039, 68.078, 15.686, 80.627, 0, 30.783, 30.783, 82.824, 23.529, 30.783, 1.789].map(y => y - 1.165);
const O_7D_V = [214, 251, 318, 336, 290, 322, 402, 371, 377, 398, 455, 488, 584];
const O_7D_X = O_7D_V.map((_, i) => 0.311 + i * 311.381 / 12);
const O_7D_Y = O_7D_V.map(v => 90 - (v - 150) / 450 * 84);
const O_BOTTOM = 112.6;
const O_DAYS = ['Apr 24, 2024', 'Apr 25, 2024', 'Apr 26, 2024', 'Apr 27, 2024', 'Apr 28, 2024', 'Apr 29, 2024', 'Apr 30, 2024'];
const O_DAYV = [214, 318, 290, 402, 377, 455, 584];

// Clicks chart (1031 × 204.3 plot, gridlines at y = 8 … 204.3)
const C_LM_X = [0, 123.498, 204.211, 305.227, 393.051, 509.299, 601.688, 697.124, 782.406, 878.345, 941.291, 1004.242, 1027.958].map(x => x + 2.026);
const C_LM_Y = [153.852, 132.0, 92.5, 108.5, 25.0, 128.5, 0, 49.061, 49.061, 132.0, 37.5, 49.061, 2.852].map(y => y + 49.452);
const C_U_X = C_LM_X.map((_, i) => 2.026 + i * 1027.958 / 12);
const cY = (v, max) => 8 + (1 - v / max) * 196.3;
const C_7D_CLK = [4.1, 5.2, 6.8, 5.9, 8.4, 7.1, 10.6, 9.2, 8.8, 6.3, 9.9, 8.1, 11.2].map(v => cY(v, 12));
const C_7D_IMP = [28, 34, 41, 37, 52, 47, 74.2, 61, 58, 44, 63, 55, 71].map(v => cY(v, 80));
const C_BOTTOM = 204.3;

// ---------------------------------------------------------------- timeline
// Data states
const TF1 = beat(16);            // 7.5  click "Last 7 days"
const TF2 = beat(44);            // 21.5 click "Last month"
const TEXIT = beat(50);          // 24.5 content resolves back to the shell

const CLICKS = [beat(14), beat(16), beat(35), beat(39), beat(42), beat(44)]; // 6.5 7.5 17 19 20.5 21.5
const MENU = [[beat(14), beat(16)], [beat(42), beat(44)]];

const STOP0 = beat(22);                                      // organic scrub stops (one per beat)
const STOPS = [0, 1, 2, 3, 4, 5, 6].map(k => STOP0 + k * BEAT);
const LEAD = 0.44;                                           // cursor leaves this long before a stop
const SCRUB_SWAP = k => k === 0 ? -Infinity : STOPS[k] - LEAD + 0.141; // midpoint crossing of crit. damped spring

const CAM_O = [720, 630, 1];
const CAM = [
  [beat(12) - 0.05, 905, 520, 1.32],   // header actions + top cards
  [beat(17) - 0.25, ...CAM_O],         // pull out: whole screen updates
  [beat(21) - 0.1, 836, 430, 1.62],    // Organic Search Traffic
  [beat(29) - 0.2, 985, 545, 1.5],     // Recommended Next Steps
  [beat(33) - 0.1, 790, 760, 1.36],    // stats + clicks chart
  [beat(41) - 0.45, 905, 520, 1.32],   // back to header
  [beat(45) - 0.25, ...CAM_O],         // overview
];

// ---------------------------------------------------------------- elements & geometry (measured once, static layout)
let E = null, G = null;
function rel(el) {
  const r = el.getBoundingClientRect(), p = E.page.getBoundingClientRect();
  return { x: r.left - p.left, y: r.top - p.top, w: r.width, h: r.height, cx: r.left - p.left + r.width / 2, cy: r.top - p.top + r.height / 2 };
}
function init() {
  E = {
    cam: $('#cam'), page: $('#page'), cursor: $('#cursor'),
    nav: $$('[data-nav]'), slots: $('#slots'), slotsFill: $('#slotsFill'), hello: $('#hello'),
    dd: $('#dd'), ddBox: $('#ddBox'), ddLabel: $('#ddLabel'), ddChev: $('#ddChev'), more: $('#moreBtn'),
    menu: $('#menu'), mi: [$('#mi0'), $('#mi1'), $('#mi2')],
    cards: [$('#card0'), $('#card1'), $('#card2')], card3: $('#card3'),
    ringArc: $('#ringArc'), ringNum: $('#ringNum'), score: $('#score'), chip0: $('#chip0'), chip0t: $('#chip0t'),
    kwCount: $('#kwCount'), kwRows: $$('[data-kw]'), kwVols: $$('[data-kw] .vol'),
    orgVal: $('#orgVal'), chip1: $('#chip1'), chip1t: $('#chip1t'),
    oChart: $('#oChart'), oArea: $('#oArea'), oLine: $('#oLine'), oClip: $('#clipORect'),
    oGuide: $('#oGuide'), oDot: $('#oDot'), oTip: $('#oTip'), oTipK: $('#oTipK'), oTipV: $('#oTipV'),
    pgRows: $$('[data-pg]'), pgVals: $$('[data-pg] .t'),
    rRows: $$('[data-rr]'),
    tiles: $$('[data-tile]'), seps: $$('[data-sep]'), tabSurf: $('#tabSurf'), tabLine: $('#tabLine'),
    legendT: $('#legendT'), ylab: $$('#ylab span'), dates: $$('#dates span'),
    cChart: $('#cChart'), cArea: $('#cArea'), cLine: $('#cLine'), cClip: $('#clipCRect'),
    cGuide: $('#cGuide'), cDot: $('#cDot'), cTip: $('#cTip'),
  };
  E.rHov = E.rRows.map(r => r.querySelector('.hov'));
  E.rCt = E.rRows.map(r => r.querySelector('.ct'));
  E.rArr = E.rRows.map(r => r.querySelector('.arr'));
  E.tileLb = E.tiles.map(t => t.querySelector('.lb span'));
  E.tileV = E.tiles.map(t => t.querySelector('.vv'));
  E.miHl = E.mi.map(m => m.querySelector('.hl'));
  E.miCk = E.mi.map(m => m.querySelector('.ck'));

  E.cam.style.transform = 'none';
  const dd = rel(E.ddBox), mi = E.mi.map(rel), oc = rel(E.oChart), cc = rel(E.cChart);
  const rows = E.rRows.map(rel), tiles = E.tiles.map(rel);
  G = { dd, mi, oc, cc, rows, tiles };

  // ---- cursor path (page coordinates): [start time, x, y, spring]
  const REST = [1150, 1092];
  const oy = oc.y + 58;
  const P = [];
  P.push([beat(11) + 0.2, dd.x + 118, dd.cy + 3]);                 // → "Last month"
  P.push([beat(15) - 0.38, mi[0].x + 70, mi[0].cy + 2]);            // → "Last 7 days"
  P.push([beat(17) - 0.2, dd.x + 150, dd.y + 150]);                 // step out of the way
  P.push([STOPS[0] - 0.8, oc.x + O_7D_X[0] + 1, oy]);               // → chart start
  for (let k = 1; k < 7; k++) P.push([STOPS[k] - LEAD, oc.x + O_7D_X[2 * k], oy]);
  P.push([beat(29) - 0.36, rows[0].x + 300, rows[0].cy + 4]);        // recommendation rows
  for (let k = 1; k < 4; k++) P.push([beat(29 + k) - 0.36, rows[k].x + 300, rows[k].cy + 4]);
  P.push([beat(33) - 0.15, tiles[1].x + 196, tiles[1].y + 58]);     // → Total Impressions (empty area right of value)
  P.push([beat(37) - 0.42, cc.x + C_U_X[6], cc.y + 118]);           // → chart peak
  P.push([beat(39) - 0.5, tiles[0].x + 214, tiles[0].y + 58]);      // → Total Clicks
  P.push([beat(41) - 0.45, dd.x + 118, dd.cy + 3]);                 // → dropdown
  P.push([beat(43) - 0.38, mi[1].x + 70, mi[1].cy + 2]);            // → "Last month"
  P.push([beat(45) + 0.3, REST[0], REST[1], S.curSlow]);            // drift home
  G.cursor = { rest: REST, path: P };
  G.cam = CAM;

  // ---- hover windows
  G.hover = {
    dd: [[beat(13) - 0.22, beat(15) - 0.2], [beat(41) - 0.05, beat(43) - 0.2]],
    mi0: [[beat(15) - 0.12, beat(16) + 0.15]],
    mi1: [[beat(43) - 0.12, beat(44) + 0.15]],
    oChart: [[STOPS[0] - 0.22, STOPS[6] + 0.3]],
    rows: [0, 1, 2, 3].map(k => [[beat(29 + k) - 0.2, beat(30 + k) - 0.2 + (k === 3 ? 0.16 : 0)]]),
    tile1: [[beat(33) + 0.3, beat(35) + 0.05]],
    tile0: [[beat(39) - 0.12, beat(39) + 0.05]],
    cChart: [[beat(37) - 0.08, beat(39) - 0.4]],
  };
}

// ---------------------------------------------------------------- sound cue sheet (read by the audio renderer)
const SOUND_EVENTS = (() => {
  const ev = [];
  const add = (t, type, gain = 1, pitch = 1) => ev.push({ t: +t.toFixed(4), type, gain, pitch });
  add(0.0, 'pop', 0.55, 0.85); add(0.5, 'pop', 0.6, 1.0); add(1.0, 'pop', 0.7, 1.12); add(1.5, 'pop', 0.6, 1.2);
  add(2.0, 'rise', 0.6, 1.0); add(2.5, 'rise', 0.5, 1.12);
  add(3.0, 'tick', 0.5, 1.2); add(3.5, 'tick', 0.45, 1.3); add(4.0, 'tick', 0.45, 1.4); add(4.5, 'rise', 0.4, 1.25);
  const hovers = [beat(13) - 0.22, beat(15) - 0.12, beat(29) - 0.2, beat(30) - 0.2, beat(31) - 0.2, beat(32) - 0.2, beat(33) + 0.3, beat(39) - 0.12, beat(41) - 0.05, beat(43) - 0.12];
  hovers.forEach(h => add(h, 'hover', 0.5));
  CLICKS.forEach(c => add(c, 'click', 1));
  MENU.forEach(([o, c]) => { add(o + 0.01, 'open', 0.6); add(c + 0.02, 'close', 0.5); });
  add(beat(35) + 0.01, 'tab', 0.6); add(beat(39) + 0.01, 'tab', 0.6);
  [beat(17), beat(45)].forEach(t => add(t, 'refresh', 0.7));
  [beat(18), beat(19), beat(20), beat(46)].forEach(t => add(t, 'tick', 0.32, 1.5));
  STOPS.forEach((s, k) => add(s - 0.02, 'scrub', 0.4, 1 + k * 0.03));
  add(beat(37), 'scrub', 0.4, 1.2);
  add(TEXIT, 'out', 0.5, 1.0); add(TEXIT + 0.7, 'out', 0.35, 0.8);
  return ev.sort((a, b) => a.t - b.t);
})();

// ---------------------------------------------------------------- formatters
const fmtInt = v => Math.round(v).toLocaleString('en-US');
const fmtClicks = v => { const n = Math.round(v * 100); return `${Math.floor(n / 100)},${String(n % 100).padStart(2, '0')}K`; };
const fmtImpr = v => { const n = Math.round(v * 10); return `${Math.floor(n / 10)}.${n % 10}M`; };

// ---------------------------------------------------------------- seek(t)
function seek(tIn) {
  const t = ((tIn % T) + T) % T;

  // ---------- camera
  const cx = track(t, CAM_O[0], G.cam.map(c => [c[0], c[1]]), S.cam);
  const cy = track(t, CAM_O[1], G.cam.map(c => [c[0], c[2]]), S.cam);
  const z  = track(t, CAM_O[2], G.cam.map(c => [c[0], c[3]]), S.cam);
  const SC = 0.92 * z;
  css(E.cam, 'transform', `translate(${(720 - cx * SC).toFixed(3)}px,${(720 - cy * SC).toFixed(3)}px) scale(${SC.toFixed(5)})`);

  // ---------- press pulses
  const press = tc => S.press(t - (tc - 0.075)) - S.press(t - (tc + 0.05));

  // ---------- shell → content (entrance / exit)
  E.nav.forEach((el, i) => {
    const L = life(t, 0.0 + i * 0.045, TEXIT + 0.95 + (E.nav.length - 1 - i) * 0.035);
    vis(el, L.op); setT(el, -12 * (1 - L.e) - 6 * L.x, 0);
  });
  { const L = life(t, 0.5, TEXIT + 0.72); vis(E.slots, L.op); setT(E.slots, 0, 8 * (1 - L.e) + 8 * L.x);
    css(E.slotsFill, 'transform', `scaleX(${clamp(spring(t - 0.62, 1.1, 0.9), 0, 1.05).toFixed(4)})`); }
  { const L = life(t, 0.5, TEXIT + 0.62); vis(E.hello, L.op); setT(E.hello, 0, 12 * (1 - L.e) + 8 * L.x); }
  const ddL = life(t, 0.56, TEXIT + 0.6), moreL = life(t, 0.62, TEXIT + 0.56);
  vis(E.more, moreL.op); setT(E.more, 0, 12 * (1 - moreL.e) + 8 * moreL.x);
  E.cards.forEach((el, i) => {
    const L = life(t, 1.0 + i * 0.07, TEXIT + 0.18 + (2 - i) * 0.07);
    vis(el, L.op); setT(el, 0, 28 * (1 - L.e) + 12 * L.x, 0.985 + 0.015 * L.e);
  });
  { const L = life(t, 1.5, TEXIT); vis(E.card3, L.op); setT(E.card3, 0, 28 * (1 - L.e) + 12 * L.x, 0.99 + 0.01 * L.e); }

  // ---------- dropdown + menu
  const hDD = windows(t, G.hover.dd);
  const pDD = press(CLICKS[0]) + press(CLICKS[4]);
  vis(E.dd, ddL.op); setT(E.dd, 0, 12 * (1 - ddL.e) + 8 * ddL.x);
  css(E.ddBox, 'transform', `scale(${(1 - 0.025 * pDD).toFixed(5)})`);
  css(E.ddBox, 'borderColor', mix('#CFCFD9', '#98A2B3', clamp(hDD)));
  css(E.ddBox, 'boxShadow', `0 1px 2px rgba(16,24,40,${(0.05 * clamp(hDD)).toFixed(3)})`);
  swap(t, E.ddLabel, [[-Infinity, 'Last month'], [TF1, 'Last 7 days'], [TF2, 'Last month']], 6);
  let m = 0; MENU.forEach(([o, c]) => { m += S.ui(t - o) - S.close(t - c); });
  m = clamp(m, 0, 1.05);
  css(E.ddChev, 'transform', `rotate(${(180 * clamp(m)).toFixed(2)}deg)`);
  vis(E.menu, clamp(m));
  css(E.menu, 'transform', `translateY(${(-6 * (1 - m)).toFixed(3)}px) scale(${(0.97 + 0.03 * m).toFixed(5)})`);
  E.mi.forEach((el, i) => {
    let e = 0; MENU.forEach(([o, c]) => { e += S.ui(t - o - 0.03 - i * 0.03) - S.close(t - c); });
    css(el, 'opacity', clamp(e).toFixed(4)); setT(el, 0, -4 * (1 - clamp(e, 0, 1.05)));
  });
  const hMi0 = windows(t, G.hover.mi0), hMi1 = windows(t, G.hover.mi1);
  css(E.miHl[0], 'opacity', (clamp(hMi0) * (1 + 0.4 * press(CLICKS[1]))).toFixed(4));
  css(E.miHl[1], 'opacity', (clamp(hMi1) * (1 + 0.4 * press(CLICKS[5]))).toFixed(4));
  css(E.miHl[2], 'opacity', '0');
  const sel7 = t >= TF1 + 0.25 && t < TF2 + 0.25;
  css(E.miCk[0], 'opacity', sel7 ? '1' : '0'); css(E.miCk[1], 'opacity', sel7 ? '0' : '1'); css(E.miCk[2], 'opacity', '0');

  // ---------- SEO health ring
  const ringV = track(t, 0, [[beat(5), 87], [beat(17), 91], [beat(45), 87]], S.ring);
  const C = 2 * Math.PI * 70;
  css(E.ringArc, 'strokeDashoffset', (C * (1 - clamp(ringV / 100))).toFixed(3));
  css(E.ringArc, 'opacity', clamp(ringV / 1.5).toFixed(3));
  { const e = S.ui(t - beat(5)); vis(E.score, clamp(e)); css(E.score, 'transform', `translate(-50%, calc(-50% + ${(6 * (1 - e)).toFixed(3)}px))`); }
  txt(E.ringNum, String(Math.round(ringV)));
  { const e = S.pop(t - beat(7)); vis(E.chip0, clamp(e)); setT(E.chip0, 0, 0, 0.88 + 0.12 * e); }
  swap(t, E.chip0t, [[-Infinity, '2.1%'], [beat(18), '3.4%'], [beat(45), '2.1%']], 6);

  // ---------- tracked keywords
  const kwV = track(t, 0, [[beat(8), 6]], S.count);
  { const e = S.ui(t - beat(8)); vis(E.kwCount, clamp(e)); setT(E.kwCount, 0, 8 * (1 - e)); txt(E.kwCount, String(Math.round(kwV))); }
  const KW_LM = ['2', '4', '0', '0'], KW_7D = ['3', '2', '1', '0'];
  E.kwRows.forEach((el, i) => { const e = S.ui(t - beat(8) - 0.05 * i); vis(el, clamp(e)); setT(el, 0, 6 * (1 - e)); });
  E.kwVols.forEach((el, i) => swap(t, el, [[-Infinity, KW_LM[i]], [beat(18) + 0.06 * i, KW_7D[i]], [beat(46) + 0.06 * i, KW_LM[i]]], 6));

  // ---------- organic traffic
  const orgV = track(t, 0, [[beat(6), 10500], [beat(17), 2640], [beat(45), 10500]], S.count);
  { const e = S.ui(t - beat(6)); vis(E.orgVal, clamp(e)); setT(E.orgVal, 0, 8 * (1 - e)); txt(E.orgVal, fmtInt(orgV)); }
  { const e = S.pop(t - beat(7) - 0.05); vis(E.chip1, clamp(e)); setT(E.chip1, 0, 0, 0.88 + 0.12 * e); }
  swap(t, E.chip1t, [[-Infinity, '2.1%'], [beat(18), '4.6%'], [beat(45), '2.1%']], 6);
  const om = track(t, 0, [[beat(17), 1], [beat(45), 0]], S.morph);
  const oxs = O_LM_X.map((x, i) => lerp(x, O_7D_X[i], om)), oys = O_LM_Y.map((y, i) => lerp(y, O_7D_Y[i], om));
  const oPath = curvePath(oxs, oys);
  attr(E.oLine, 'd', oPath);
  attr(E.oArea, 'd', `${oPath}L${oxs[12].toFixed(2)},${O_BOTTOM}L${oxs[0].toFixed(2)},${O_BOTTOM}Z`);
  attr(E.oClip, 'width', (S.draw(t - beat(6)) * 318).toFixed(2));

  // ---------- cursor (page coordinates → screen)
  let px = G.cursor.rest[0], py = G.cursor.rest[1];
  { let prevX = px, prevY = py;
    for (const [ts, x, y, sp] of G.cursor.path) { const k = (sp || S.cur)(t - ts); px += (x - prevX) * k; py += (y - prevY) * k; prevX = x; prevY = y; } }

  // organic scrub: tooltip follows the cursor; value from the stop the cursor is at
  const hO = windows(t, G.hover.oChart);
  { const lx = clamp(px - G.oc.x, 0, 312), ly = curveY(oxs, oys, lx);
    const a = clamp(hO);
    vis(E.oGuide, a * 0.9); css(E.oGuide, 'height', `${O_BOTTOM - 12}px`); setT(E.oGuide, lx, 0);
    vis(E.oDot, a); setT(E.oDot, lx, ly, 0.6 + 0.4 * a);
    const kItems = [[-Infinity, O_DAYS[0]]], vItems = [[-Infinity, String(O_DAYV[0])]];
    for (let k = 1; k < 7; k++) { kItems.push([SCRUB_SWAP(k), O_DAYS[k]]); vItems.push([SCRUB_SWAP(k), String(O_DAYV[k])]); }
    swap(t, E.oTipK, kItems, 0); swap(t, E.oTipV, vItems, 5);
    const w = E.oTip.offsetWidth, h = E.oTip.offsetHeight, side = clamp((lx - 150) / 60);
    const tx = lerp(lx + 16, lx - 16 - w, side * side * (3 - 2 * side)), ty = clamp(ly - h / 2, -24, 96 - h + 18);
    vis(E.oTip, a); setT(E.oTip, tx, ty + 6 * (1 - a), 0.96 + 0.04 * a); }

  // ---------- top pages
  const PG_LM = [100, 80, 65], PG_7D = ['24K', '19K', '15K'];
  E.pgRows.forEach((el, i) => { const e = S.ui(t - beat(8) - 0.05 - 0.05 * i); vis(el, clamp(e)); setT(el, 0, 6 * (1 - e)); });
  E.pgVals.forEach((el, i) => {
    const cnt = tt => `${Math.round(track(tt, 0, [[beat(8) + 0.05 * i, PG_LM[i]]], S.count))}K`;
    swap(t, el, [[-Infinity, cnt], [beat(19) + 0.06 * i, PG_7D[i]], [beat(46) + 0.06 * i, `${PG_LM[i]}K`]], 6);
  });

  // ---------- recommended next steps
  E.rRows.forEach((el, i) => {
    const e = S.ui(t - beat(7) - 0.06 * i);
    css(E.rCt[i], 'opacity', clamp(e).toFixed(4)); setT(E.rCt[i], 0, 8 * (1 - e));
    const h = clamp(windows(t, G.hover.rows[i]));
    css(E.rHov[i], 'opacity', h.toFixed(4));
    css(E.rArr[i], 'opacity', clamp(e).toFixed(4)); setT(E.rArr[i], 4 * h, 0);
  });

  // ---------- stats tabs
  const tabS = track(t, 0, [[beat(35), 1], [beat(39), 0]], S.ui);
  css(E.tabSurf, 'transform', `translateX(${(tabS * 278).toFixed(3)}px)`);
  css(E.tabSurf, 'borderTopLeftRadius', `${(12 * clamp(1 - tabS)).toFixed(2)}px`);
  css(E.tabLine, 'transform', `translateX(${(tabS * 278).toFixed(3)}px)`);
  const hT1 = windows(t, G.hover.tile1), hT0 = windows(t, G.hover.tile0);
  const pT1 = press(CLICKS[2]), pT0 = press(CLICKS[3]);
  E.tiles.forEach((el, i) => {
    const w = clamp(1 - Math.abs(tabS - i));
    css(E.tileLb[i], 'color', mix('#686685', '#5D5F6C', w));
    css(E.tileV[i], 'color', mix('#392B65', '#120242', w));
    const h = i === 1 ? hT1 : i === 0 ? hT0 : 0;
    css(el, 'background', `rgba(255,255,255,${(0.5 * clamp(h) * (1 - w)).toFixed(3)})`);
    const p = i === 1 ? pT1 : i === 0 ? pT0 : 0;
    css(el, 'transform', `scale(${(1 - 0.015 * p).toFixed(5)})`);
  });
  E.seps.forEach((el, j) => css(el, 'opacity', clamp(Math.min(Math.abs(tabS - (j + 1)), Math.abs(tabS - (j + 2))) * 1.6).toFixed(3)));
  const ST_LM = ['15,63K', '2.1M', '1%', '40'], ST_7D = ['3,72K', '486K', '0.8%', '38'];
  const stCount = [v => fmtClicks(v), v => fmtImpr(v), v => `${Math.round(v)}%`, v => String(Math.round(v))];
  const stTo = [15.63, 2.1, 1, 40];
  E.tileV.forEach((el, i) => {
    const t0 = beat(9) + 0.08 * i;
    const cnt = tt => stCount[i](track(tt, 0, [[t0, stTo[i]]], S.count));
    swap(t, el, [[-Infinity, cnt], [beat(20) + 0.06 * i, ST_7D[i]], [beat(46) + 0.06 * i, ST_LM[i]]], 7);
    if (t < beat(20)) { const e = S.ui(t - t0); css(el, 'opacity', clamp(e).toFixed(4)); setT(el, 0, 6 * (1 - e)); }
  });

  // ---------- clicks chart
  const cPts = vtrack(t, [...C_LM_X, ...C_LM_Y], [
    [beat(20), [...C_U_X, ...C_7D_CLK]], [beat(36), [...C_U_X, ...C_7D_IMP]],
    [beat(40), [...C_U_X, ...C_7D_CLK]], [beat(46), [...C_LM_X, ...C_LM_Y]]], S.morph);
  const cxs = cPts.slice(0, 13), cys = cPts.slice(13);
  const cPath = curvePath(cxs, cys);
  attr(E.cLine, 'd', cPath);
  attr(E.cArea, 'd', `${cPath}L${cxs[12].toFixed(2)},${C_BOTTOM}L${cxs[0].toFixed(2)},${C_BOTTOM}Z`);
  attr(E.cClip, 'width', (S.draw(t - beat(10)) * 1034).toFixed(2));
  attr(E.cClip, 'height', (C_BOTTOM + 30).toFixed(2));
  swap(t, E.legendT, [[-Infinity, 'Clicks'], [beat(35), 'Impressions'], [beat(39), 'Clicks']], 6);
  const Y_LM = ['36', '27', '18', '9', '0'], Y_7C = ['12', '9', '6', '3', '0'], Y_7I = ['80K', '60K', '40K', '20K', '0'];
  E.ylab.forEach((el, i) => {
    const d = 0.03 * i;
    swap(t, el, [[-Infinity, Y_LM[i]], [beat(20) + d, Y_7C[i]], [beat(36) + d, Y_7I[i]], [beat(40) + d, Y_7C[i]], [beat(46) + d, Y_LM[i]]], 5);
    if (t < beat(20)) { const e = S.ui(t - beat(10) - d); css(el, 'opacity', clamp(e).toFixed(4)); }
  });
  const D_LM = ['01/04/2024', '05/04/2024', '10/04/2024', '15/04/2024', '20/04/2024', '25/04/2024', '30/04/2024'];
  const D_7D = ['24/04/2024', '25/04/2024', '26/04/2024', '27/04/2024', '28/04/2024', '29/04/2024', '30/04/2024'];
  E.dates.forEach((el, i) => {
    const d = 0.03 * i;
    swap(t, el, [[-Infinity, D_LM[i]], [beat(20) + 0.05 + d, D_7D[i]], [beat(46) + 0.05 + d, D_LM[i]]], 5);
    if (t < beat(20)) { const e = S.ui(t - beat(10) - 0.05 - d); css(el, 'opacity', clamp(e).toFixed(4)); setT(el, 0, 4 * (1 - e)); }
  });
  const hC = clamp(windows(t, G.hover.cChart));
  { const lx = clamp(px - G.cc.x, 0, 1031), ly = curveY(cxs, cys, lx);
    vis(E.cGuide, hC * 0.9); css(E.cGuide, 'height', `${C_BOTTOM - 8}px`); setT(E.cGuide, lx, 8);
    vis(E.cDot, hC); setT(E.cDot, lx, ly, 0.6 + 0.4 * hC);
    vis(E.cTip, hC); setT(E.cTip, lx + 16, ly - 26 + 6 * (1 - hC), 0.96 + 0.04 * hC); }

  // ---------- cursor render (screen space, constant size)
  const sx = 720 + (px - cx) * SC, sy = 720 + (py - cy) * SC;
  let pAll = 0; CLICKS.forEach(c => { pAll += press(c); });
  css(E.cursor, 'transform', `translate(${(sx - 4.2).toFixed(3)}px,${(sy - 2.6).toFixed(3)}px) scale(${(1 - 0.14 * clamp(pAll)).toFixed(4)})`);
}

// ---------------------------------------------------------------- boot
const ready = (async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map(i => i.decode().catch(() => {})));
  init(); seek(0);
})();
window.MOTION = { T, BPM, BEAT, beat, seek: t => seek(t), ready, SOUND_EVENTS };

const q = new URLSearchParams(location.search);
if (!q.has('render')) {
  ready.then(() => {
    if (q.has('t')) { seek(parseFloat(q.get('t'))); return; }
    const t0 = performance.now();
    const loop = now => { seek((now - t0) / 1000); requestAnimationFrame(loop); };  // preview driver only
    requestAnimationFrame(loop);
  });
}
})();
