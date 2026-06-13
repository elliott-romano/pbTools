/* Scan Smear — WebGL2 slit-scan + perspective-echo smear, black & white.
   Recreates the directional "combed" smear / stepped perspective-tunnel look.
   No build step, no deps. Open index.html directly. */

function showError(msg) {
  let el = document.getElementById("err-banner");
  if (!el) {
    el = document.createElement("div");
    el.id = "err-banner";
    el.style.cssText =
      "position:fixed;left:0;right:0;top:0;z-index:9999;background:#b5232e;color:#fff;" +
      "font:12px/1.5 ui-monospace,Menlo,monospace;padding:10px 14px;white-space:pre-wrap;" +
      "max-height:50vh;overflow:auto;box-shadow:0 2px 12px rgba(0,0,0,.5)";
    document.body.appendChild(el);
  }
  el.textContent = "⚠ " + msg;
}
window.addEventListener("error", e =>
  showError((e.error && e.error.stack) || e.message || String(e)));
window.addEventListener("unhandledrejection", e =>
  showError("Promise rejection: " + (e.reason && e.reason.message || e.reason)));

(function () {
  "use strict";

  // ---------------------------------------------------------------- Shaders
  const VERT = `#version 300 es
  in vec2 a_pos;
  out vec2 v_uv;
  void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }`;

  const FRAG = `#version 300 es
  precision highp float;

  in vec2 v_uv;
  out vec4 outColor;

  uniform sampler2D u_img;
  uniform vec2  u_res;
  uniform vec2  u_vanish;   // vanishing point / smear origin (uv)
  uniform float u_aspect;

  uniform int   u_steps;
  uniform float u_zoom;     // per-step scale toward vanish (perspective). 1 = none
  uniform float u_drift;    // per-step translate along angle (linear smear)
  uniform float u_angle;    // radians
  uniform float u_decay;    // accumulation weight falloff

  uniform float u_quant;    // 0..1 staircase amount
  uniform float u_cell;     // quantization cell size (uv)

  uniform float u_slitAmp;  // slit displacement amplitude
  uniform float u_slitFreq; // slit displacement frequency across the scan axis
  uniform float u_slitNoise;// organic noise mixed into the slit displacement

  uniform float u_striAmt;  // fine "combed" striation contrast
  uniform float u_striFreq; // striation line frequency
  uniform float u_grain;    // film grain / dust

  uniform float u_mono;     // 0..1 desaturate to grayscale
  uniform float u_contrast;
  uniform float u_black;    // black level (levels low)
  uniform float u_white;    // white level (levels high)
  uniform float u_invert;   // 0..1

  uniform float u_mix;      // blend effect over original
  uniform float u_phase;    // animated phase

  float hash(vec2 p){ p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y); }
  float vnoise(vec2 p){
    vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
    float a=hash(i), b=hash(i+vec2(1.0,0.0)), c=hash(i+vec2(0.0,1.0)), d=hash(i+vec2(1.0,1.0));
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
  }

  void main(){
    vec2 asp  = vec2(u_aspect, 1.0);
    vec2 dir  = vec2(cos(u_angle), sin(u_angle));
    vec2 perp = vec2(-dir.y, dir.x);

    vec2 p = v_uv;
    vec3 col = vec3(0.0);
    float wsum = 0.0, w = 1.0;

    int steps = u_steps;
    for (int i = 0; i < 128; i++) {
      if (i >= steps) break;

      vec2 sp = p;

      // --- slit-scan: displace the sample ALONG the scan axis based on the
      //     coordinate ACROSS it -> the fine combed striation / smear ---
      float across = dot((sp - u_vanish) * asp, perp);
      float s = sin(across * u_slitFreq - u_phase);
      float n = vnoise(vec2(across * u_slitFreq * 0.15, float(i) * 0.7)) - 0.5;
      sp += dir * ((s * u_slitAmp) + n * u_slitNoise) / asp;

      // --- staircase quantization ---
      vec2 q = floor(sp / u_cell + 0.5) * u_cell;
      sp = mix(sp, q, u_quant);

      vec3 c = texture(u_img, sp).rgb;
      col += c * w; wsum += w; w *= u_decay;

      // advance: perspective zoom toward vanish + parallel drift
      p = u_vanish + (p - u_vanish) * u_zoom + dir * u_drift;
    }
    col /= max(wsum, 1e-4);

    // --- tone / black & white ---
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    vec3 toned = mix(col, vec3(lum), u_mono);
    toned = (toned - 0.5) * u_contrast + 0.5;                     // contrast
    toned = (toned - u_black) / max(u_white - u_black, 1e-3);     // levels

    // combed striation lines (parallel to the smear direction)
    float comb = 0.5 + 0.5 * sin(dot(v_uv * asp, perp) * u_striFreq);
    toned *= 1.0 - u_striAmt * comb;

    // grain / dust
    float g = hash(v_uv * u_res + vec2(u_phase, u_phase * 1.7)) - 0.5;
    toned += g * u_grain;

    toned = mix(toned, 1.0 - toned, u_invert);
    toned = clamp(toned, 0.0, 1.0);

    vec3 base = texture(u_img, v_uv).rgb;
    outColor = vec4(mix(base, toned, u_mix), 1.0);
  }`;

  // ---------------------------------------------------------------- GL setup
  const canvas = document.getElementById("glcanvas");
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
  if (!gl) { showError("WebGL2 is not available in this browser."); return; }

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const name = type === gl.VERTEX_SHADER ? "vertex" : "fragment";
      throw new Error(`${name} shader compile failed:\n` + gl.getShaderInfoLog(sh));
    }
    return sh;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error("program link failed:\n" + gl.getProgramInfoLog(prog));
  }
  gl.useProgram(prog);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aloc = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(aloc);
  gl.vertexAttribPointer(aloc, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  ["u_res","u_vanish","u_aspect","u_steps","u_zoom","u_drift","u_angle","u_decay",
   "u_quant","u_cell","u_slitAmp","u_slitFreq","u_slitNoise","u_striAmt","u_striFreq",
   "u_grain","u_mono","u_contrast","u_black","u_white","u_invert","u_mix","u_phase"
  ].forEach(n => U[n] = gl.getUniformLocation(prog, n));

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([30, 30, 34, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  // ---------------------------------------------------------------- Presets
  const PRESETS = {
    tunnel: {
      angle: 90, steps: 56, zoom: 0.93, drift: 0.0, decay: 0.92,
      quant: 0.5, cell: 0.008,
      slitAmp: 0.006, slitFreq: 50, slitNoise: 0.3,
      striAmt: 0.30, striFreq: 900, grain: 0.07,
      mono: 1.0, contrast: 1.5, black: 0.06, white: 0.92, invert: 0,
      mix: 1.0, vanish: [0.5, 0.5],
    },
    smear: {
      angle: 90, steps: 96, zoom: 1.0, drift: 0.004, decay: 0.96,
      quant: 0.0, cell: 0.01,
      slitAmp: 0.02, slitFreq: 28, slitNoise: 0.6,
      striAmt: 0.18, striFreq: 1200, grain: 0.05,
      mono: 1.0, contrast: 1.6, black: 0.08, white: 0.9, invert: 0,
      mix: 1.0, vanish: [0.5, 0.55],
    },
    fan: {
      angle: 90, steps: 64, zoom: 0.9, drift: 0.0, decay: 0.9,
      quant: 0.6, cell: 0.006,
      slitAmp: 0.012, slitFreq: 60, slitNoise: 0.45,
      striAmt: 0.35, striFreq: 700, grain: 0.06,
      mono: 1.0, contrast: 1.55, black: 0.05, white: 0.93, invert: 0,
      mix: 1.0, vanish: [0.5, 0.85],
    },
  };

  // ---------------------------------------------------------------- State
  const state = Object.assign({ animate: false, wrap: "mirror", speed: 0.6 },
    JSON.parse(JSON.stringify(PRESETS.tunnel)));
  let phase = 0, imgW = 0, imgH = 0, hasImage = false;

  // ---------------------------------------------------------------- Controls
  // key, label, min, max, step, formatter
  const SPECS = {
    "g-geo": [
      ["angle", "Angle (°)",      0, 180, 1,     v => (v|0) + "°"],
      ["steps", "Steps / echoes", 1, 128, 1,     v => v|0],
      ["zoom",  "Zoom per step",  0.80, 1.20, 0.001, v => v.toFixed(3)],
      ["drift", "Drift per step", -0.02, 0.02, 0.0002, v => v.toFixed(4)],
      ["decay", "Falloff",        0.50, 1.00, 0.005, v => v.toFixed(2)],
    ],
    "g-step": [
      ["quant", "Staircase amount", 0.0, 1.0, 0.01, v => v.toFixed(2)],
      ["cell",  "Step size",        0.001, 0.05, 0.0005, v => v.toFixed(4)],
    ],
    "g-slit": [
      ["slitAmp",   "Slit amount",    0.0, 0.08, 0.0005, v => v.toFixed(4)],
      ["slitFreq",  "Slit frequency", 2.0, 160.0, 0.5, v => v.toFixed(1)],
      ["slitNoise", "Slit organic",   0.0, 1.0, 0.01, v => v.toFixed(2)],
    ],
    "g-tex": [
      ["striAmt",  "Striation amount",    0.0, 0.8, 0.01, v => v.toFixed(2)],
      ["striFreq", "Striation frequency", 50, 4000, 10, v => v|0],
      ["grain",    "Grain / dust",        0.0, 0.3, 0.005, v => v.toFixed(3)],
    ],
    "g-tone": [
      ["mono",     "Desaturate", 0.0, 1.0, 0.01, v => v.toFixed(2)],
      ["contrast", "Contrast",   0.5, 2.5, 0.01, v => v.toFixed(2)],
      ["black",    "Black point", 0.0, 0.5, 0.005, v => v.toFixed(3)],
      ["white",    "White point", 0.5, 1.2, 0.005, v => v.toFixed(3)],
    ],
    "g-mot": [
      ["speed", "Flow speed", 0.0, 6.0, 0.01, v => v.toFixed(2)],
    ],
    "g-look": [
      ["mix", "Effect mix", 0.0, 1.0, 0.01, v => v.toFixed(2)],
    ],
  };

  const controls = [];
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  for (const [groupId, rows] of Object.entries(SPECS)) {
    const host = document.getElementById(groupId);
    for (const [key, name, min, max, step, fmt] of rows) {
      const wrap = document.createElement("div");
      wrap.className = "ctrl";

      const row = document.createElement("div");
      row.className = "row";
      const nameEl = document.createElement("span");
      nameEl.className = "name"; nameEl.textContent = name;

      const num = document.createElement("input");
      num.className = "num";
      num.type = "number"; num.min = min; num.max = max; num.step = step;

      row.appendChild(nameEl); row.appendChild(num);

      const slider = document.createElement("input");
      slider.type = "range"; slider.min = min; slider.max = max; slider.step = step;

      wrap.appendChild(row); wrap.appendChild(slider);
      host.appendChild(wrap);

      const ctl = {
        key, slider, num, min, max, step, fmt,
        sync() {
          slider.value = state[key];
          if (document.activeElement !== num) num.value = fmt(state[key]);
        },
      };
      ctl.sync();

      function commit(v) {
        if (!isFinite(v)) return;
        state[key] = clamp(v, min, max);
        ctl.sync();
        render();
      }
      slider.addEventListener("input", () => commit(parseFloat(slider.value)));
      num.addEventListener("input", () => {
        const v = parseFloat(num.value);
        if (isFinite(v)) { state[key] = clamp(v, min, max); slider.value = state[key]; render(); }
      });
      num.addEventListener("change", () => commit(parseFloat(num.value)));
      num.addEventListener("blur", () => ctl.sync());
      num.addEventListener("keydown", e => { if (e.key === "Enter") num.blur(); });

      controls.push(ctl);
    }
  }

  function syncAll() {
    for (const ctl of controls) ctl.sync();
    document.getElementById("invert").checked = state.invert >= 0.5;
    document.getElementById("animate").checked = state.animate;
    document.getElementById("wrapMode").value = state.wrap;
  }

  // ---------------------------------------------------------------- Wrap mode
  function applyWrap() {
    let m = gl.MIRRORED_REPEAT;
    if (state.wrap === "clamp") m = gl.CLAMP_TO_EDGE;
    else if (state.wrap === "repeat") m = gl.REPEAT;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, m);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, m);
  }

  // ---------------------------------------------------------------- Render
  function render() {
    if (!hasImage) { gl.clearColor(0.05, 0.05, 0.06, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.u_res, canvas.width, canvas.height);
    gl.uniform2f(U.u_vanish, state.vanish[0], state.vanish[1]);
    gl.uniform1f(U.u_aspect, canvas.width / canvas.height);
    gl.uniform1i(U.u_steps, state.steps | 0);
    gl.uniform1f(U.u_zoom, state.zoom);
    gl.uniform1f(U.u_drift, state.drift);
    gl.uniform1f(U.u_angle, state.angle * Math.PI / 180);
    gl.uniform1f(U.u_decay, state.decay);
    gl.uniform1f(U.u_quant, state.quant);
    gl.uniform1f(U.u_cell, state.cell);
    gl.uniform1f(U.u_slitAmp, state.slitAmp);
    gl.uniform1f(U.u_slitFreq, state.slitFreq);
    gl.uniform1f(U.u_slitNoise, state.slitNoise);
    gl.uniform1f(U.u_striAmt, state.striAmt);
    gl.uniform1f(U.u_striFreq, state.striFreq);
    gl.uniform1f(U.u_grain, state.grain);
    gl.uniform1f(U.u_mono, state.mono);
    gl.uniform1f(U.u_contrast, state.contrast);
    gl.uniform1f(U.u_black, state.black);
    gl.uniform1f(U.u_white, state.white);
    gl.uniform1f(U.u_invert, state.invert);
    gl.uniform1f(U.u_mix, state.mix);
    gl.uniform1f(U.u_phase, phase);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  let rafId = null;
  function loop() { phase += state.speed * 0.05; render(); rafId = requestAnimationFrame(loop); }
  function setAnimate(on) {
    state.animate = on;
    if (on && rafId === null) loop();
    if (!on && rafId !== null) { cancelAnimationFrame(rafId); rafId = null; render(); }
  }

  // ---------------------------------------------------------------- Image load
  const dropHint = document.getElementById("drop-hint");
  const originDot = document.getElementById("origin-dot");
  const statusEl = document.getElementById("status");

  function loadImageBitmap(img) {
    imgW = img.naturalWidth || img.width;
    imgH = img.naturalHeight || img.height;
    const MAX = 2200;
    let w = imgW, h = imgH;
    const m = Math.max(w, h);
    if (m > MAX) { const s = MAX / m; w = Math.round(w * s); h = Math.round(h * s); }
    canvas.width = w; canvas.height = h;

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    applyWrap();

    hasImage = true;
    dropHint.classList.add("hidden");
    originDot.style.display = "block";
    updateOriginDot();
    statusEl.textContent = `${imgW}×${imgH}px${m > MAX ? ` (rendering at ${w}×${h})` : ""}`;
    render();
  }

  function loadFromFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { loadImageBitmap(img); URL.revokeObjectURL(url); };
    img.onerror = () => { statusEl.textContent = "Failed to load image."; URL.revokeObjectURL(url); };
    img.src = url;
  }

  document.getElementById("loadBtn").addEventListener("click", () =>
    document.getElementById("fileInput").click());
  document.getElementById("fileInput").addEventListener("change", e => {
    if (e.target.files[0]) loadFromFile(e.target.files[0]);
  });

  const stage = document.getElementById("stage");
  ["dragenter", "dragover"].forEach(ev => stage.addEventListener(ev, e => {
    e.preventDefault(); stage.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach(ev => stage.addEventListener(ev, e => {
    e.preventDefault(); stage.classList.remove("dragover");
  }));
  stage.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) loadFromFile(f); });
  window.addEventListener("paste", e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith("image/"));
    if (item) loadFromFile(item.getAsFile());
  });

  // ---------------------------------------------------------------- Click origin
  function updateOriginDot() {
    const rect = canvas.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const x = rect.left - stageRect.left + state.vanish[0] * rect.width;
    const y = rect.top - stageRect.top + (1 - state.vanish[1]) * rect.height;
    originDot.style.left = x + "px";
    originDot.style.top = y + "px";
  }
  function setOriginFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    let x = (e.clientX - rect.left) / rect.width;
    let y = (e.clientY - rect.top) / rect.height;
    state.vanish = [clamp(x, 0, 1), clamp(1 - y, 0, 1)];
    updateOriginDot();
    render();
  }
  let dragging = false;
  canvas.addEventListener("pointerdown", e => { dragging = true; setOriginFromEvent(e); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", e => { if (dragging) setOriginFromEvent(e); });
  canvas.addEventListener("pointerup", () => { dragging = false; });
  window.addEventListener("resize", () => { if (hasImage) updateOriginDot(); });

  document.getElementById("centerBtn").addEventListener("click", () => {
    state.vanish = [0.5, 0.5]; updateOriginDot(); render();
  });

  // ---------------------------------------------------------------- Misc UI
  document.getElementById("animate").addEventListener("change", e => setAnimate(e.target.checked));
  document.getElementById("invert").addEventListener("change", e => { state.invert = e.target.checked ? 1 : 0; render(); });
  document.getElementById("wrapMode").addEventListener("change", e => { state.wrap = e.target.value; applyWrap(); render(); });

  function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    Object.assign(state, JSON.parse(JSON.stringify(p)));
    syncAll();
    applyWrap();
    updateOriginDot();
    render();
  }
  document.getElementById("preset").addEventListener("change", e => applyPreset(e.target.value));

  document.getElementById("resetBtn").addEventListener("click", () => {
    const name = document.getElementById("preset").value;
    state.animate = false; setAnimate(false);
    applyPreset(name);
  });

  document.getElementById("saveBtn").addEventListener("click", () => {
    if (!hasImage) { statusEl.textContent = "Load an image first."; return; }
    render();
    canvas.toBlob(blob => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "scan-smear.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
  });

  // ---------------------------------------------------------------- Starter image
  // A grayscale architectural-ish pattern so the effect reads on launch.
  function makeStarterImage() {
    const c = document.createElement("canvas");
    c.width = 1024; c.height = 1024;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, "#1a1a1a"); g.addColorStop(0.55, "#777"); g.addColorStop(1, "#e8e8e8");
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    // vertical structures
    for (let i = 0; i < 40; i++) {
      const px = (i / 40) * c.width;
      x.fillStyle = i % 2 ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.14)";
      x.fillRect(px, 0, c.width / 80, c.height);
    }
    // a bright blob and a dark blob for tonal range
    let rg = x.createRadialGradient(c.width * 0.5, c.height * 0.32, 8, c.width * 0.5, c.height * 0.32, 240);
    rg.addColorStop(0, "rgba(255,255,255,0.95)"); rg.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = rg; x.fillRect(0, 0, c.width, c.height);
    rg = x.createRadialGradient(c.width * 0.3, c.height * 0.7, 8, c.width * 0.3, c.height * 0.7, 200);
    rg.addColorStop(0, "rgba(0,0,0,0.8)"); rg.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = rg; x.fillRect(0, 0, c.width, c.height);
    return c;
  }

  syncAll();
  applyWrap();
  loadImageBitmap(makeStarterImage());
  statusEl.textContent = "Starter image — drop your own, or click the canvas to set the origin.";
  render();
})();
