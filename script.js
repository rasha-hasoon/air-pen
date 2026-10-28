// ============================================================
// Air Pen (smooth edition)
// Keys: 1-5 colour | R rainbow | Z undo | Space clear
//       F fullscreen | Shift = pen-down (backup)
// ============================================================

const CONFIG = {
  colors: ['rgb(176, 225, 255)', '#ff6b6b', '#ffd93d', '#6bff95', '#d96bff'],
  lineWidth: 6,

  // --- Smoothing (One Euro filter) ---
  // Units: screen-heights per second. Tune these two first.
  minCutoff: 1.7,   // LOWER = steadier when slow/still, but more lag. RAISE if pen feels floaty.
  beta: 6,          // HIGHER = less lag on fast strokes, but a bit more jitter while moving.
  dCutoff: 1.0,     // smoothing of the speed estimate itself (leave alone)

  // --- Pinch detection (ratio of thumb-index gap to hand size) ---
  pinchOn: 0.30,          // pinch closer than this -> pen down
  pinchOff: 0.45,         // open wider than this  -> pen up (hysteresis)
  pinchConfirmFrames: 2,  // frames the pinch must hold before the pen goes down
  releaseTrimMs: 90,      // drop the last N ms of a stroke to remove the "release flick"

  // --- Pen position ---
  anchor: 'midpoint',     // 'midpoint' (thumb+index, steady while pinching) or 'tip' (index tip)
  margin: 0.08,           // ignore this fraction at each camera edge so you can reach screen edges

  // --- Misc ---
  minPointDist: 1.5,      // px; skip points closer than this (no clumping when still)
  lostGraceMs: 200,       // tolerate brief tracking dropouts without cutting the stroke
  rainbowHuePerPx: 0.35,  // hue degrees per px travelled (frame-rate independent)
  minDotMs: 100           // single-point strokes shorter than this are treated as accidents
};

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const ink = document.createElement('canvas');   // cache of finished strokes
const inkCtx = ink.getContext('2d');

// Strokes store points in normalised (0..1) coordinates, so resizing needs no maths.
let strokes = [];
let current = null;

let penColor = CONFIG.colors[0];
let rainbow = false;
let hue = 0;

let shiftHeld = false;
let pinching = false;
let pinchCount = 0;
let waitRelease = false;

let pos = null;          // filtered pen position (normalised)
let lastSeen = 0;

let W = 0, H = 0, dpr = 1;

// ---------------- One Euro filter (2D, shared cutoff) ----------------
class OneEuro2D {
  constructor() { this.reset(); }
  reset() { this.t = null; this.x = 0; this.y = 0; this.dx = 0; this.dy = 0; }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(x, y, tMs) {
    if (this.t === null) {
      this.t = tMs; this.x = x; this.y = y;
      return { x, y };
    }
    const dt = Math.min(0.1, Math.max(1 / 120, (tMs - this.t) / 1000));
    this.t = tMs;

    const ad = OneEuro2D.alpha(CONFIG.dCutoff, dt);
    this.dx += ad * ((x - this.x) / dt - this.dx);
    this.dy += ad * ((y - this.y) / dt - this.dy);
    const speed = Math.hypot(this.dx, this.dy);

    const a = OneEuro2D.alpha(CONFIG.minCutoff + CONFIG.beta * speed, dt);
    this.x += a * (x - this.x);
    this.y += a * (y - this.y);
    return { x: this.x, y: this.y };
  }
}
const filter = new OneEuro2D();

// ---------------- Canvas sizing ----------------
function resizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = canvas.width = ink.width = Math.floor(window.innerWidth * dpr);
  H = canvas.height = ink.height = Math.floor(window.innerHeight * dpr);
  rebuildInk();
}
window.addEventListener('resize', resizeCanvas);

// ---------------- Stroke rendering ----------------
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// Segment i (1..n-1) is a quadratic curve through midpoints, with p[i] as control.
// The last segment ends exactly on the newest point, so ink never trails the cursor.
function segStart(pts, i) { return i === 1 ? pts[0] : mid(pts[i - 1], pts[i]); }
function segTo(c, pts, i) {
  const p = pts[i];
  const e = i < pts.length - 1 ? mid(p, pts[i + 1]) : p;
  c.quadraticCurveTo(p.x * W, p.y * H, e.x * W, e.y * H);
}

function drawStroke(c, s) {
  const pts = s.points, n = pts.length;
  if (!n) return;
  const lw = CONFIG.lineWidth * dpr;

  // Glow is faked with wide translucent passes (no shadowBlur = fast, no beads at joints).
  const passes = [
    { w: lw * 3,   a: 0.10 },
    { w: lw * 1.8, a: 0.22 },
    { w: lw,       a: 1 }
  ];

  c.lineJoin = 'round';

  if (n === 1) {
    for (const p of passes) {
      c.globalAlpha = p.a;
      c.fillStyle = s.rainbow ? `hsl(${pts[0].h},100%,65%)` : s.color;
      c.beginPath();
      c.arc(pts[0].x * W, pts[0].y * H, p.w / 2, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    return;
  }

  for (const p of passes) {
    c.lineWidth = p.w;
    c.globalAlpha = p.a;

    if (!s.rainbow) {
      c.lineCap = 'round';
      c.strokeStyle = s.color;
      c.beginPath();
      c.moveTo(pts[0].x * W, pts[0].y * H);
      for (let i = 1; i < n; i++) segTo(c, pts, i);
      c.stroke();
    } else {
      // Per-segment colour. Translucent passes use butt caps so overlaps don't make bright dots.
      c.lineCap = p.a < 1 ? 'butt' : 'round';
      for (let i = 1; i < n; i++) {
        const st = segStart(pts, i);
        c.strokeStyle = `hsl(${pts[i].h},100%,65%)`;
        c.beginPath();
        c.moveTo(st.x * W, st.y * H);
        segTo(c, pts, i);
        c.stroke();
      }
    }
  }
  c.globalAlpha = 1;
  c.lineCap = 'round';
}

function rebuildInk() {
  inkCtx.clearRect(0, 0, W, H);
  for (const s of strokes) drawStroke(inkCtx, s);
}

function drawCursor() {
  if (!pos) return;
  const drawingNow = pinching || shiftHeld;
  const base = rainbow ? `hsl(${hue},100%,65%)` : penColor;
  ctx.save();
  ctx.shadowColor = base;
  ctx.shadowBlur = 15 * dpr;
  ctx.fillStyle = drawingNow ? '#FFFFFF' : base;
  ctx.beginPath();
  ctx.arc(pos.x * W, pos.y * H, 6 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function render() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(ink, 0, 0);
  if (current) drawStroke(ctx, current);
  drawCursor();
}

// ---------------- Stroke lifecycle ----------------
function addPoint(now) {
  const last = current.points[current.points.length - 1];
  if (last) {
    const d = Math.hypot((pos.x - last.x) * W, (pos.y - last.y) * H) / dpr;
    if (d < CONFIG.minPointDist) return;
    if (current.rainbow) hue = (hue + d * CONFIG.rainbowHuePerPx) % 360;
  }
  current.points.push({ x: pos.x, y: pos.y, t: now, h: hue });
}

function endStroke(now, trim) {
  if (!current) return;
  const s = current;
  current = null;

  if (trim && s.points.length > 3) {
    const cutoff = now - CONFIG.releaseTrimMs;
    let n = s.points.length;
    while (n > 1 && s.points[n - 1].t > cutoff) n--;
    s.points.length = n;
  }

  // Ignore accidental one-point taps, but allow deliberate dots (held pinch).
  if (s.points.length === 1 && now - s.startT < CONFIG.minDotMs) return;
  if (!s.points.length) return;

  strokes.push(s);
  drawStroke(inkCtx, s);
}

function updateStroke(now) {
  const wanted = pinching || shiftHeld;

  if (waitRelease) {
    if (!wanted) waitRelease = false;
    return;
  }

  if (wanted) {
    if (!current) {
      current = { points: [], color: penColor, rainbow, startT: now };
    }
    addPoint(now);
  } else if (current) {
    endStroke(now, true);
  }
}

function loseHand(now) {
  endStroke(now, false);
  pos = null;
  pinching = false;
  pinchCount = 0;
  filter.reset();
}

// ---------------- Hand tracking ----------------
function dist3(a, b) {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  return Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh, (a.z - b.z) * vw);
}

function updatePinch(lm) {
  const scale = dist3(lm[0], lm[9]);
  const ratio = scale > 1 ? dist3(lm[4], lm[8]) / scale : 1;
  const below = ratio < (pinching ? CONFIG.pinchOff : CONFIG.pinchOn);
  pinchCount = below ? pinchCount + 1 : 0;
  pinching = below && (pinching || pinchCount >= CONFIG.pinchConfirmFrames);
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function onResults(results) {
  const now = performance.now();

  const hands = results.multiHandLandmarks;
  if (!hands || hands.length === 0) return;   // tick() handles the dropout grace period

  const lm = hands[0];
  lastSeen = now;
  updatePinch(lm);

  const a = CONFIG.anchor === 'tip'
    ? lm[8]
    : { x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 };

  const m = CONFIG.margin;
  const nx = clamp01((a.x - m) / (1 - 2 * m));
  const ny = clamp01((a.y - m) / (1 - 2 * m));

  // Filter in isotropic units (screen heights) so x and y are treated equally.
  const aspect = W / H;
  const f = filter.filter(nx * aspect, ny, now);
  pos = { x: f.x / aspect, y: f.y };

  updateStroke(now);
}

// ---------------- Render loop (decoupled from the tracker) ----------------
function tick(now) {
  requestAnimationFrame(tick);
  if (pos && now - lastSeen > CONFIG.lostGraceMs) loseHand(now);
  render();
}

// ---------------- Controls ----------------
function undo() {
  if (current) { current = null; waitRelease = true; return; }
  if (strokes.pop()) rebuildInk();
}

function clearAll() {
  strokes = [];
  current = null;
  waitRelease = pinching || shiftHeld;
  rebuildInk();
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (err) {
    console.error('Fullscreen failed:', err);
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') { shiftHeld = true; return; }

  const k = e.key.toLowerCase();
  if (e.code === 'Space') { e.preventDefault(); clearAll(); }
  else if (k === 'f' && !e.repeat) toggleFullscreen();
  else if (k === 'r' && !e.repeat) rainbow = !rainbow;
  else if (k === 'z') undo();
  else if (/^[1-9]$/.test(e.key) && CONFIG.colors[+e.key - 1]) {
    penColor = CONFIG.colors[+e.key - 1];
    rainbow = false;
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') shiftHeld = false;
});

window.addEventListener('blur', () => { shiftHeld = false; });

// ---------------- Start ----------------
resizeCanvas();
requestAnimationFrame(tick);

const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

hands.onResults(onResults);

const camera = new Camera(video, {
  onFrame: async () => { await hands.send({ image: video }); },
  width: 1280,
  height: 720
});

camera.start();