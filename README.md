# Air Pen ✍️

Draw on a wall with your finger using a webcam, a projector, and [MediaPipe Hands](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker).

<!-- Keep the existing demo image line from the original README here -->

## How it works

1. **The webcam sees your hand.** MediaPipe tracks your thumb and index finger.
2. **The browser draws.** The page draws a glowing line wherever your pen point goes. Pinch your thumb and index finger together to put the pen down, or hold Shift if you prefer the keyboard.
3. **The projector shows it on the wall.** Share or cast the browser tab to the projector (or use it as a second screen), and the wall becomes your canvas.

The projector doesn't need any setup. It just displays the tab.

## Run it

```bash
git clone https://github.com/gprem09/air-pen.git
cd air-pen
python3 -m http.server 8000
```

Open <http://localhost:8000>, allow camera access, and share the tab to your projector.

## Controls

| Input | Action |
|-------|--------|
| **Pinch** thumb + index | Draw |
| **Shift** (hold) | Draw (keyboard alternative) |
| **1 – 5** | Switch pen colour |
| **R** | Toggle rainbow pen |
| **Z** | Undo last stroke |
| **Space** | Clear everything |
| **F** | Fullscreen |

## Tips for smooth writing

- Keep your hand fully in the camera's view, with good, even lighting.
- The pen sits at the midpoint between your thumb and index finger, so it stays steady while you pinch and release.
- If the pen goes down too early or too late, adjust `pinchOn` / `pinchOff` (see Tuning below).

## Tuning

All settings are in the `CONFIG` block at the top of `script.js`:

| Setting | What it does |
|---------|--------------|
| `minCutoff` | Lower = steadier when slow or still, higher = less lag |
| `beta` | Higher = better tracking on fast strokes |
| `pinchOn` / `pinchOff` | Pinch distance to start and stop drawing |
| `releaseTrimMs` | Trims the end of a stroke to remove the flick when you release |
| `anchor` | `'midpoint'` (default) or `'tip'` to draw from the index fingertip |
| `colors` | The 1–5 pen colour palette |