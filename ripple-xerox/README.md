# Ripple Xerox

A GPU image tool that repeats a source image like a xerox feedback scan, but warped
by radial ripple waves + fractal noise so the repeats flow organically, like ripples
in water. Runs entirely in the browser via a WebGL2 fragment shader — real-time at
full image resolution.

## Run

Just open `index.html` in a browser (Chrome/Safari/Firefox). No server, no build, no
dependencies. (If you prefer a local server: `python3 -m http.server` in this folder.)

## Use

1. **Load image** (button), or drag-and-drop / paste an image onto the canvas.
2. **Click the canvas** to set where the ripples start (drag to move it live).
3. Tune the sliders.

## Controls

**Repetition** — the "xerox copy-of-a-copy" stack
- *Echoes* — how many repeated copies are layered.
- *Zoom per echo* — how much each copy scales toward the origin (<1 zooms in, >1 out).
- *Falloff* — how quickly deeper echoes fade out.
- *Rotation/echo* — twist each successive copy (spiral feedback).

**Ripples** — the "water" warp
- *Ripple strength* — displacement amplitude of the radial wave.
- *Ripple frequency* — how many concentric ripples.

**Organic variation** — the "natural, not mechanical" part
- *Variation amount* — fractal-noise wobble added to each sample.
- *Variation scale* — noise feature size (low = big swirls, high = fine grain).
- *Per-echo drift* — how much the noise changes between copies (more = less uniform).

**Motion** — *Animate* makes the ripples flow outward; *Flow speed* sets the rate.

**Look** — *Edge wrap* (mirror/clamp/tile), *Effect mix* (blend over original), *Gamma*.

**Output** — *Save PNG* exports the current frame at render resolution.

## Notes

- Images larger than 2200px on the long edge are rendered at 2200 for performance;
  raise `MAX` in `app.js` if you have the GPU headroom and want full-res export.
- The whole effect is one fragment shader in `app.js` (the `FRAG` string) — the
  feedback loop, ripple wave, and fbm noise all live there if you want to tweak the math.
