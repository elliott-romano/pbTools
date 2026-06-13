/* Ripple Xerox — WebGL2 feedback/Droste echo warped by radial ripples + fbm noise.
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
  uniform vec2  u_res;        // canvas resolution (px)
  uniform vec2  u_center;     // ripple origin, uv space (0..1)
  uniform float u_aspect;     // width / height

  uniform int   u_echoes;     // number of feedback copies
  uniform float u_zoom;       // scale toward center per echo (1 = none)
  uniform float u_falloff;    // weight decay per echo
  uniform float u_rotate;     // radians rotation per echo

  uniform float u_rAmp;       // ripple displacement amplitude
  uniform float u_rFreq;      // ripple spatial frequency
  uniform float u_phase;      // animated phase

  uniform float u_orgAmp;     // organic noise displacement amount
  uniform float u_orgScale;   // noise spatial frequency
  uniform float u_orgEvolve;  // per-echo noise evolution (variation between copies)

  uniform float u_mix;        // blend effect over original (0..1)
  uniform float u_gamma;      // contrast-ish accumulation shaping

  // --- hash / value-noise fbm ---
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i + vec2(0.0, 0.0));
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, amp = 0.5;
    for (int i = 0; i < 4; i++) {
      s += amp * vnoise(p);
      p = p * 2.02 + vec2(7.1, 3.7);
      amp *= 0.5;
    }
    return s;
  }

  vec2 rot(vec2 v, float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c) * v;
  }

  void main() {
    // aspect-corrected space so ripples are circular, centered on origin
    vec2 uv = v_uv;
    vec2 asp = vec2(u_aspect, 1.0);
    vec2 p = (uv - u_center) * asp;   // position relative to center, corrected

    vec3 col = vec3(0.0);
    float wsum = 0.0;
    float w = 1.0;

    int echoes = u_echoes;
    for (int i = 0; i < 64; i++) {
      if (i >= echoes) break;
      float fi = float(i);

      float r = length(p);
      vec2  dir = r > 1e-5 ? p / r : vec2(0.0);

      // radial ripple wave (the "water" part)
      float wave = sin(r * u_rFreq - u_phase);
      // organic per-echo noise field (the "natural variation" part)
      vec2 np = (p / asp + u_center) * u_orgScale + fi * u_orgEvolve;
      float n = fbm(np) - 0.5;

      // displace sample coordinate
      p += dir * (wave * u_rAmp) + vec2(n) * u_orgAmp
           + dir * (fbm(np * 1.7) - 0.5) * u_orgAmp;

      // zoom toward center + rotate => the xerox "copy of a copy"
      p = rot(p, u_rotate) * u_zoom;

      // sample (convert back to uv)
      vec2 suv = p / asp + u_center;
      vec3 s = texture(u_img, suv).rgb;

      col += s * w;
      wsum += w;
      w *= u_falloff;
    }

    col /= max(wsum, 1e-4);
    col = pow(col, vec3(u_gamma));

    vec3 base = texture(u_img, uv).rgb;
    col = mix(base, col, u_mix);

    outColor = vec4(col, 1.0);
  }`;

  // ---------------------------------------------------------------- GL setup
  const canvas = document.getElementById("glcanvas");
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
  if (!gl) {
    alert("WebGL2 is not available in this browser.");
    return;
  }

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
    throw new Error(gl.getProgramInfoLog(prog));
  }
  gl.useProgram(prog);

  // fullscreen triangle
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  ["u_res","u_center","u_aspect","u_echoes","u_zoom","u_falloff","u_rotate",
   "u_rAmp","u_rFreq","u_phase","u_orgAmp","u_orgScale","u_orgEvolve",
   "u_mix","u_gamma"].forEach(n => U[n] = gl.getUniformLocation(prog, n));

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([40, 40, 50, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  // ---------------------------------------------------------------- State
  const state = {
    center: [0.5, 0.5],
    echoes: 18, zoom: 0.94, falloff: 0.86, rotate: 0.0,
    rAmp: 0.025, rFreq: 38.0, speed: 0.6,
    orgAmp: 0.012, orgScale: 4.0, orgEvolve: 0.35,
    mix: 1.0, gamma: 1.0,
    animate: false, wrap: "mirror",
  };
  const DEFAULTS = JSON.parse(JSON.stringify(state));

  let imgW = 0, imgH = 0, hasImage = false;
  let phase = 0;

  // ---------------------------------------------------------------- Controls UI
  const SPECS = {
    "g-rep": [
      ["echoes",  "Echoes",         1, 64, 1,    v => v|0],
      ["zoom",    "Zoom per echo",  0.80, 1.20, 0.001, v => v.toFixed(3)],
      ["falloff", "Falloff",        0.40, 1.00, 0.005, v => v.toFixed(2)],
      ["rotate",  "Rotation/echo",  -0.30, 0.30, 0.001, v => (v).toFixed(3)],
    ],
    "g-rip": [
      ["rAmp",  "Ripple strength", 0.0, 0.12, 0.0005, v => v.toFixed(4)],
      ["rFreq", "Ripple frequency", 2.0, 120.0, 0.5, v => v.toFixed(1)],
    ],
    "g-org": [
      ["orgAmp",    "Variation amount", 0.0, 0.06, 0.0005, v => v.toFixed(4)],
      ["orgScale",  "Variation scale",  0.5, 16.0, 0.1, v => v.toFixed(1)],
      ["orgEvolve", "Per-echo drift",   0.0, 2.0, 0.01, v => v.toFixed(2)],
    ],
    "g-mot": [
      ["speed", "Flow speed", 0.0, 4.0, 0.01, v => v.toFixed(2)],
    ],
    "g-look": [
      ["mix",   "Effect mix", 0.0, 1.0, 0.01, v => v.toFixed(2)],
      ["gamma", "Gamma",      0.5, 2.0, 0.01, v => v.toFixed(2)],
    ],
  };

  const controls = []; // {key, slider, num, sync, min, max, step, fmt}
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

      // editable number field (type to set the value directly)
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
        sync() {                       // push state -> widgets
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
      // number field: live update while typing, clamp & tidy on blur/enter
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
    if (!hasImage) {
      gl.clearColor(0.06, 0.06, 0.08, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.u_res, canvas.width, canvas.height);
    gl.uniform2f(U.u_center, state.center[0], state.center[1]);
    gl.uniform1f(U.u_aspect, canvas.width / canvas.height);
    gl.uniform1i(U.u_echoes, state.echoes | 0);
    gl.uniform1f(U.u_zoom, state.zoom);
    gl.uniform1f(U.u_falloff, state.falloff);
    gl.uniform1f(U.u_rotate, state.rotate);
    gl.uniform1f(U.u_rAmp, state.rAmp);
    gl.uniform1f(U.u_rFreq, state.rFreq);
    gl.uniform1f(U.u_phase, phase);
    gl.uniform1f(U.u_orgAmp, state.orgAmp);
    gl.uniform1f(U.u_orgScale, state.orgScale);
    gl.uniform1f(U.u_orgEvolve, state.orgEvolve);
    gl.uniform1f(U.u_mix, state.mix);
    gl.uniform1f(U.u_gamma, state.gamma);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  let rafId = null;
  function loop() {
    phase += state.speed * 0.05;
    render();
    rafId = requestAnimationFrame(loop);
  }
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
    // cap resolution for performance / GPU limits
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

  // drag & drop
  const stage = document.getElementById("stage");
  ["dragenter", "dragover"].forEach(ev => stage.addEventListener(ev, e => {
    e.preventDefault(); stage.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach(ev => stage.addEventListener(ev, e => {
    e.preventDefault(); stage.classList.remove("dragover");
  }));
  stage.addEventListener("drop", e => {
    const f = e.dataTransfer.files[0];
    if (f) loadFromFile(f);
  });
  // paste
  window.addEventListener("paste", e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith("image/"));
    if (item) loadFromFile(item.getAsFile());
  });

  // ---------------------------------------------------------------- Click origin
  function updateOriginDot() {
    const rect = canvas.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const x = rect.left - stageRect.left + state.center[0] * rect.width;
    const y = rect.top - stageRect.top + (1 - state.center[1]) * rect.height;
    originDot.style.left = x + "px";
    originDot.style.top = y + "px";
  }
  function setOriginFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    let x = (e.clientX - rect.left) / rect.width;
    let y = (e.clientY - rect.top) / rect.height;
    x = Math.min(1, Math.max(0, x));
    y = Math.min(1, Math.max(0, y));
    state.center = [x, 1 - y]; // flip Y for GL uv
    updateOriginDot();
    render();
  }
  let dragging = false;
  canvas.addEventListener("pointerdown", e => { dragging = true; setOriginFromEvent(e); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", e => { if (dragging) setOriginFromEvent(e); });
  canvas.addEventListener("pointerup", () => { dragging = false; });
  window.addEventListener("resize", () => { if (hasImage) updateOriginDot(); });

  document.getElementById("centerBtn").addEventListener("click", () => {
    state.center = [0.5, 0.5]; updateOriginDot(); render();
  });

  // ---------------------------------------------------------------- Misc UI
  document.getElementById("animate").addEventListener("change", e => setAnimate(e.target.checked));
  document.getElementById("wrapMode").addEventListener("change", e => {
    state.wrap = e.target.value; applyWrap(); render();
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    Object.assign(state, JSON.parse(JSON.stringify(DEFAULTS)));
    state.center = [0.5, 0.5];
    for (const ctl of controls) ctl.sync();
    document.getElementById("animate").checked = false;
    document.getElementById("wrapMode").value = state.wrap;
    setAnimate(false); applyWrap(); updateOriginDot(); render();
  });

  document.getElementById("saveBtn").addEventListener("click", () => {
    if (!hasImage) { statusEl.textContent = "Load an image first."; return; }
    render(); // ensure current frame is in the buffer
    canvas.toBlob(blob => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "ripple-xerox.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
  });

  // ---------------------------------------------------------------- Starter image
  // Synthesize a colorful pattern so the effect + controls are live on launch,
  // before the user loads anything of their own.
  function makeStarterImage() {
    const c = document.createElement("canvas");
    c.width = 1024; c.height = 768;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, c.width, c.height);
    g.addColorStop(0, "#ff5e62"); g.addColorStop(0.5, "#7b2ff7"); g.addColorStop(1, "#21d4fd");
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    const cols = ["#ffd166", "#06d6a0", "#ef476f", "#118ab2", "#ffffff", "#0b132b"];
    for (let i = 0; i < 60; i++) {
      const px = ((i * 97) % 32) / 32 * c.width;
      const py = ((i * 53) % 24) / 24 * c.height;
      const r = 18 + ((i * 31) % 70);
      x.fillStyle = cols[i % cols.length];
      x.globalAlpha = 0.85;
      x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
    }
    x.globalAlpha = 1;
    x.fillStyle = "#0b132b";
    x.font = "bold 90px -apple-system, sans-serif";
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText("RIPPLE", c.width / 2, c.height / 2);
    return c;
  }
  loadImageBitmap(makeStarterImage());
  statusEl.textContent = "Starter image — drop your own image, or click the canvas to set origin.";

  render();
})();
