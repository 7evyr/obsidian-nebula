// Nebula: a hub at the centre, one tilted orbit ring per folder, every note a glowing node,
// real links drawn between them, light beads running along links. Renderer only: no Obsidian imports.
import * as THREE from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export const DEFAULTS = {
  color: "#2cf27f", glow: 0.75, glowSize: 0.45, nodeSize: 1.15, links: 1.4, rings: 1, beads: 420, beadSpeed: 1, comets: true,
  spin: 0.3, pulse: true, stars: true, labels: true, quality: "high", saveGpu: true,
};
const SWATCHES = [["Green", "#2cf27f"], ["White", "#ffffff"], ["Ice", "#9fdcff"], ["Violet", "#b38cff"], ["Amber", "#ffc46b"]];
const QUALITY = { fast: 1, high: 1.75, max: 2.5 };
const MAX_BEADS = 800;
const ease = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

const POINT_VS = `
  attribute float aSize; attribute float aBoost; attribute float aPhase;
  uniform float uScale; uniform float uTime; uniform float uSizeMul; uniform float uPulse;
  varying float vBoost; varying float vFade;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float pulse = 1.0 + uPulse * 0.18 * sin(uTime * 1.6 + aPhase);
    gl_PointSize = aSize * uSizeMul * pulse * (1.0 + aBoost * 0.9) * uScale / -mv.z;
    vBoost = aBoost; vFade = clamp(1.25 - (-mv.z) / 900.0, 0.45, 1.0);
    gl_Position = projectionMatrix * mv;
  }`;
const POINT_FS = `
  uniform vec3 uColor; varying float vBoost; varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float halo = pow(1.0 - d * 2.0, 2.2);
    float core = smoothstep(0.16, 0.0, d);
    vec3 col = uColor * (halo * 0.5) + vec3(1.0) * core * (0.3 + vBoost * 0.7);
    gl_FragColor = vec4(col * vFade * (0.7 + vBoost * 0.8), halo * vFade * 0.8);
  }`;

export class Constellation {
  /**
   * @param {HTMLElement} el container
   * @param {{notes:{id:string,name:string,group:string}[], links:[string,string][]}} data
   * @param {{settings?:object, onOpen?:(id:string)=>void, onSettings?:(s:object)=>void, onFocus?:()=>void, force?:boolean}} opts
   */
  constructor(el, data, opts = {}) {
    this.el = el; this.opts = opts; this.data = data;
    this.s = Object.assign({}, DEFAULTS, opts.settings || {});
    this.reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.t0 = performance.now(); this.running = true; this.hover = -1; this._last = 0; this.frames = 0; this.spinPause = 0;
    this.root = document.createElement("div"); this.root.className = "nebula-root"; el.appendChild(this.root);
    this._build(); this._ui(); this._events(); this.apply();
    this._loop = this._loop.bind(this); window.requestAnimationFrame(this._loop);
  }

  _build() {
    const w = Math.max(this.el.clientWidth, 200), h = Math.max(this.el.clientHeight, 200);
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[this.s.quality] || 1.75)); r.setSize(w, h); r.setClearColor(0x000000, 1);
    r.toneMapping = THREE.NoToneMapping; this.root.appendChild(r.domElement); r.domElement.className = "nebula-canvas";
    const scene = (this.scene = new THREE.Scene());
    const cam = (this.camera = new THREE.PerspectiveCamera(52, w / h, 0.5, 900));
    const color = (this.color = new THREE.Color(this.s.color));

    // layout: biggest folders on the inner rings
    const notes = this.data.notes, groups = new Map();
    notes.forEach((n, i) => { if (!groups.has(n.group)) groups.set(n.group, []); groups.get(n.group).push(i); });
    const order = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    this.groupInfo = [];
    const N = notes.length, total = N + order.length + 1;
    const pos = new Float32Array(total * 3), size = new Float32Array(total), boost = new Float32Array(total), phase = new Float32Array(total);
    this.index = new Map(notes.map((n, i) => [n.id, i + 1])); // slot 0 = core
    const v = new THREE.Vector3(), eu = new THREE.Euler();
    const deg = new Uint16Array(total);
    for (const [a, b] of this.data.links) { const x = this.index.get(a), y = this.index.get(b); if (x && y) { deg[x]++; deg[y]++; } }
    this.ringLines = [];
    const fs = Math.min(2.4, Math.max(0.5, 3.0 / Math.pow(Math.max(N, 50) / 100, 0.3)));
    let acc = 28;
    order.forEach(([name, ids], gi) => {
      const spread = 1.0 + Math.sqrt(ids.length) * 0.42; acc += 5 + spread * 1.1; const radius = acc; acc += spread * 1.1;
      eu.set((gi % 2 ? 1 : -1) * (0.16 + 0.07 * (gi % 5)), 0, 0.11 * (gi % 7) - 0.25);
      const hubSlot = N + 1 + gi, R = rng(hash(name));
      const ha = gi * 2.39996; v.set(Math.cos(ha) * radius, 0, Math.sin(ha) * radius).applyEuler(eu); pos.set([v.x, v.y, v.z], hubSlot * 3); size[hubSlot] = 4.2 * fs; phase[hubSlot] = R() * 6;
      ids.forEach((id, k) => {
        const slot = id + 1, th = (k / ids.length) * Math.PI * 2 + (R() - 0.5) * 0.35;
        const rr = radius + (R() - 0.5) * spread * 2, y = (R() - 0.5) * spread * 0.7;
        v.set(Math.cos(th) * rr, y, Math.sin(th) * rr).applyEuler(eu); pos.set([v.x, v.y, v.z], slot * 3);
        size[slot] = (1.3 + Math.min(4.2, Math.sqrt(deg[slot])) * 0.8) * fs; phase[slot] = R() * 6.28;
      });
      const seg = 220, lp = new Float32Array(seg * 3);
      for (let s = 0; s < seg; s++) { const th = (s / seg) * Math.PI * 2; v.set(Math.cos(th) * radius, 0, Math.sin(th) * radius).applyEuler(eu); lp.set([v.x, v.y, v.z], s * 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(lp, 3));
      const ring = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
      scene.add(ring); this.ringLines.push(ring); (this.ringPts = this.ringPts || []).push(lp);
      this.groupInfo.push({ name, count: ids.length, slot: hubSlot });
    });
    this.pos = pos;

    // note nodes
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    this.boostAttr = new THREE.BufferAttribute(boost, 1); geo.setAttribute("aBoost", this.boostAttr);
    this.uniforms = { uColor: { value: color }, uScale: { value: h * 0.62 }, uTime: { value: 0 }, uSizeMul: { value: 1 }, uPulse: { value: 1 } };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({ vertexShader: POINT_VS, fragmentShader: POINT_FS, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false; scene.add(this.points);
    this.raycaster = new THREE.Raycaster(); this.raycaster.params.Points.threshold = 0.9;

    // links (randomly thinned past 6000 so huge vaults stay light)
    this.adj = new Map(); const edges = [];
    for (const [a, b] of this.data.links) {
      const x = this.index.get(a), y = this.index.get(b); if (!x || !y || x === y) continue;
      edges.push([x, y]);
      (this.adj.get(x) || this.adj.set(x, []).get(x)).push(y); (this.adj.get(y) || this.adj.set(y, []).get(y)).push(x);
    }
    const cap = 6000; let use = edges;
    if (edges.length > cap) { const R = rng(7); use = edges.filter(() => R() < cap / edges.length); }
    const lp = new Float32Array(use.length * 6);
    use.forEach(([x, y], i) => { lp.set(pos.subarray(x * 3, x * 3 + 3), i * 6); lp.set(pos.subarray(y * 3, y * 3 + 3), i * 6 + 3); });
    this.edges = use;
    const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.BufferAttribute(lp, 3));
    const lc = (this.linkFade = new Float32Array(lp.length / 3));
    for (let i = 0; i < lc.length; i += 2) { const dx = lp[i * 3] - lp[i * 3 + 3], dy = lp[i * 3 + 1] - lp[i * 3 + 4], dz = lp[i * 3 + 2] - lp[i * 3 + 5]; const f = Math.min(1, Math.max(0.12, 1.25 - Math.sqrt(dx * dx + dy * dy + dz * dz) / 110)); lc[i] = lc[i + 1] = f; }
    lg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(lp.length), 3)); this.linkGeo = lg; this._linkColors();
    this.linkMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false });
    scene.add((this.links = new THREE.LineSegments(lg, this.linkMat)));

    // hover neighbour lines
    this.hoverGeo = new THREE.BufferGeometry(); this.hoverGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(600 * 6), 3)); this.hoverGeo.setDrawRange(0, 0);
    this.hoverLines = new THREE.LineSegments(this.hoverGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.hoverLines.frustumCulled = false; scene.add(this.hoverLines);

    // light beads along links
    this.beads = [];
    const R2 = rng(3); for (let i = 0; i < MAX_BEADS; i++) this.beads.push({ e: use.length ? use[Math.floor(R2() * use.length)] : [0, 0], t: R2(), s: 0.12 + R2() * 0.22 });
    const bg = new THREE.BufferGeometry(); bg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_BEADS * 3), 3));
    this.beadMat = new THREE.PointsMaterial({ map: this._dotTex(), color: 0xffffff, size: 2.2, sizeAttenuation: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.beadPts = new THREE.Points(bg, this.beadMat); this.beadPts.frustumCulled = false; scene.add(this.beadPts);

    // core + star dust
    this.core = this._coreSprite(); scene.add(this.core);
    // comets: a bright head with a fading tail racing round every ring
    this.comets = []; const TL = 34;
    this.ringPts.forEach((lp, i) => {
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TL * 3), 3)); g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(TL * 3), 3));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); line.frustumCulled = false;
      scene.add(line); const R = rng(100 + i); this.comets.push({ line, lp, ph: R(), sp: (0.025 + R() * 0.05) * (R() < 0.5 ? -1 : 1), TL });
    });
    // halos spinning round the core
    this.halos = [0.95, 1.35, 1.8].map((k, i) => {
      const seg = 128, a = new Float32Array(seg * 3); for (let s = 0; s < seg; s++) { const th = (s / seg) * Math.PI * 2; a.set([Math.cos(th), Math.sin(th), 0], s * 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(a, 3));
      const l = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 - i * 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
      l.userData = { k, ax: new THREE.Vector3(Math.sin(i * 2.1), Math.cos(i * 1.3), Math.sin(i * 0.7 + 1)).normalize(), sp: 0.5 + i * 0.35 }; l.rotation.set(i * 0.9, i * 1.7, 0); scene.add(l); return l;
    });
    const dust = new Float32Array(1800 * 3), R3 = rng(11);
    for (let i = 0; i < 1800; i++) { const rr = acc * 0.7 + R3() * acc * 2.6, a = R3() * 6.283, b = Math.acos(2 * R3() - 1); dust.set([rr * Math.sin(b) * Math.cos(a), rr * Math.cos(b), rr * Math.sin(b) * Math.sin(a)], i * 3); }
    const dg = new THREE.BufferGeometry(); dg.setAttribute("position", new THREE.BufferAttribute(dust, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0x9a9aa4, size: 0.9, sizeAttenuation: true, transparent: true, opacity: 0.35, depthWrite: false }));
    scene.add(this.dust);

    // post: bloom
    const comp = (this.composer = new EffectComposer(r));
    comp.addPass(new RenderPass(scene, cam));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.4, 0.4); comp.addPass(this.bloom);
    comp.addPass(new OutputPass()); comp.setSize(w, h);

    // camera + free rotation (trackball: no pole lock, roll all the way around)
    const far = (this.far = Math.max(60, acc * 1.25)); this.coreSize = Math.max(12, acc * 0.085);
    cam.far = far * 16; cam.updateProjectionMatrix();
    const c = (this.controls = new TrackballControls(cam, r.domElement));
    Object.assign(c, { rotateSpeed: 2.6, zoomSpeed: 1.1, panSpeed: 0.7, staticMoving: false, dynamicDampingFactor: 0.1, minDistance: 8, maxDistance: far * 7 });
    this.home = new THREE.Vector3(0, far * 0.42, far);
    cam.position.copy(this.reduced ? this.home : this.home.clone().multiplyScalar(2.6)); c.target.set(0, 0, 0);
    this.flyStart = performance.now(); this.flying = !this.reduced;
  }

  _dotTex() {
    const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,255,255,.8)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  }

  _linkColors() {
    const a = this.linkGeo.attributes.color.array, c = this.color;
    for (let i = 0; i < this.linkFade.length; i++) { const f = this.linkFade[i]; a[i * 3] = c.r * f; a[i * 3 + 1] = c.g * f; a[i * 3 + 2] = c.b * f; }
    this.linkGeo.attributes.color.needsUpdate = true;
  }

  // plain glowing rounded square, no logo
  _coreSprite() {
    const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d");
    const rgb = this.color, rgba = (a) => `rgba(${Math.round(rgb.r * 255)},${Math.round(rgb.g * 255)},${Math.round(rgb.b * 255)},${a})`;
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    const glow = g.createRadialGradient(128, 128, 40, 128, 128, 128); glow.addColorStop(0, rgba(0.5)); glow.addColorStop(1, rgba(0)); g.fillStyle = glow; g.fillRect(0, 0, 256, 256);
    rr(56, 56, 144, 144, 38); const fill = g.createLinearGradient(0, 56, 0, 200); fill.addColorStop(0, rgba(0.98)); fill.addColorStop(1, rgba(0.72)); g.fillStyle = fill; g.fill();
    g.lineWidth = 3; g.strokeStyle = "rgba(255,255,255,.55)"; g.stroke();
    const shine = g.createLinearGradient(0, 60, 0, 130); shine.addColorStop(0, "rgba(255,255,255,.35)"); shine.addColorStop(1, "rgba(255,255,255,0)");
    rr(64, 62, 128, 64, 30); g.fillStyle = shine; g.fill();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.95, depthTest: false })); s.renderOrder = 10; return s;
  }

  _ui() {
    const mk = (cls, parent = this.root, tag = "div") => { const e = document.createElement(tag); e.className = cls; parent.appendChild(e); return e; };
    this.labelLayer = mk("nebula-labels");
    this.hubLabels = this.groupInfo.map((g) => { const e = mk("nebula-label", this.labelLayer); mk("", e, "b").textContent = g.name; mk("", e, "span").textContent = `${g.count} notes`; e.addEventListener("click", () => this.focusSlot(g.slot)); return e; });
    this.tip = mk("nebula-tip"); this.tip.classList.add("is-hidden");
    mk("nebula-hud").textContent = `${this.data.notes.length.toLocaleString()} notes · ${this.groupInfo.length} rings · ${this.edges.length.toLocaleString()} links`;
    this.fpsEl = mk("nebula-fps");
    mk("nebula-hint").textContent = "Left drag to spin any way · right drag to move · scroll to zoom · click a note to open it";
    const bar = mk("nebula-bar");
    const b1 = mk("nebula-btn", bar, "button"); b1.textContent = "Reset view"; b1.addEventListener("click", () => this.resetView());
    const b2 = mk("nebula-btn", bar, "button"); b2.textContent = "Focus"; b2.addEventListener("click", () => this.opts.onFocus && this.opts.onFocus());
    const b3 = mk("nebula-btn", bar, "button"); b3.textContent = "Customize"; b3.addEventListener("click", () => this.panel.classList.toggle("is-open"));
    this._panel(mk);
  }

  _panel(mk) {
    const p = (this.panel = mk("nebula-panel"));
    mk("nebula-ph", p).textContent = "Customize";
    const row = (label) => { const r = mk("nebula-row", p); mk("nebula-rl", r).textContent = label; return r; };
    // color
    const cr = row("Color"), sw = mk("nebula-sw", cr);
    SWATCHES.forEach(([name, hex]) => { const b = mk("nebula-dot", sw, "button"); b.title = name; b.style.background = hex; b.addEventListener("click", () => this.set({ color: hex })); });
    const pick = mk("nebula-pick", sw, "input"); pick.type = "color"; pick.value = this.s.color; pick.addEventListener("input", () => this.set({ color: pick.value })); this.picker = pick;
    const slider = (label, key, min, max, step) => {
      const r = row(label), inp = mk("nebula-range", r, "input"), out = mk("nebula-val", r, "span");
      Object.assign(inp, { type: "range", min, max, step, value: this.s[key] });
      const show = () => (out.textContent = key === "beads" ? String(Math.round(this.s[key])) : (+this.s[key]).toFixed(2));
      inp.addEventListener("input", () => { this.set({ [key]: +inp.value }); show(); }); show();
      (this._inputs = this._inputs || []).push(() => { inp.value = this.s[key]; show(); });
    };
    slider("Glow", "glow", 0, 2, 0.05);
    slider("Glow size", "glowSize", 0, 1, 0.05);
    slider("Node size", "nodeSize", 0.3, 3, 0.05);
    slider("Links", "links", 0, 3, 0.05);
    slider("Rings", "rings", 0, 3, 0.05);
    slider("Light beads", "beads", 0, MAX_BEADS, 10);
    slider("Bead speed", "beadSpeed", 0.1, 4, 0.1);
    slider("Spin", "spin", 0, 2, 0.05);
    const toggle = (label, key) => {
      const r = row(label), b = mk("nebula-tog", r, "button");
      const show = () => { b.classList.toggle("is-on", !!this.s[key]); b.textContent = this.s[key] ? "On" : "Off"; };
      b.addEventListener("click", () => { this.set({ [key]: !this.s[key] }); show(); }); show();
      (this._inputs = this._inputs || []).push(show);
    };
    toggle("Comets", "comets"); toggle("Pulse", "pulse"); toggle("Stars", "stars"); toggle("Folder names", "labels"); toggle("Save GPU in background", "saveGpu");
    const qr = row("Quality"), seg = mk("nebula-seg", qr);
    this._qBtns = Object.keys(QUALITY).map((q) => { const b = mk("nebula-segb", seg, "button"); b.textContent = q[0].toUpperCase() + q.slice(1); b.addEventListener("click", () => this.set({ quality: q })); return [q, b]; });
    const reset = mk("nebula-btn nebula-reset", p, "button"); reset.textContent = "Reset to default";
    reset.addEventListener("click", () => { this.set(Object.assign({}, DEFAULTS)); this.picker.value = this.s.color; (this._inputs || []).forEach((f) => f()); });
  }

  set(patch) {
    Object.assign(this.s, patch); this.apply(patch);
    window.clearTimeout(this._saveT); this._saveT = window.setTimeout(() => this.opts.onSettings && this.opts.onSettings(Object.assign({}, this.s)), 300);
  }

  apply(patch) {
    const s = this.s;
    if (!patch || "color" in patch) {
      this.color.set(s.color); this.ringLines.forEach((r) => r.material.color.copy(this.color)); this.halos.forEach((l) => l.material.color.copy(this.color)); this._linkColors();
      const old = this.core; this.core = this._coreSprite(); this.scene.add(this.core); if (old) { this.scene.remove(old); old.material.map.dispose(); old.material.dispose(); }
      this.root.style.setProperty("--nebula-color", s.color); if (this.picker) this.picker.value = s.color;
    }
    this.bloom.strength = s.glow; this.bloom.radius = s.glowSize;
    this.uniforms.uSizeMul.value = s.nodeSize; this.uniforms.uPulse.value = s.pulse && !this.reduced ? 1 : 0;
    this.linkMat.opacity = 0.1 * s.links; this.links.visible = s.links > 0;
    this.ringLines.forEach((r) => { r.material.opacity = 0.2 * s.rings; r.visible = s.rings > 0; });
    this.beadPts.geometry.setDrawRange(0, Math.min(MAX_BEADS, Math.round(s.beads))); this.beadPts.visible = s.beads > 0;
    this.dust.visible = !!s.stars; this.comets.forEach((c) => (c.line.visible = !!s.comets && s.rings > 0)); this.labelLayer.style.display = s.labels ? "" : "none";
    if (!patch || "quality" in patch) { this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[s.quality] || 1.75)); this.resize(); }
    if (this._qBtns) this._qBtns.forEach(([q, b]) => b.classList.toggle("is-on", q === s.quality));
  }

  resetView() {
    this._fly = { t0: performance.now(), from: this.controls.target.clone(), to: new THREE.Vector3(), cf: this.camera.position.clone(), ct: this.home.clone() };
    this.camera.up.set(0, 1, 0);
  }

  _events() {
    const cv = this.renderer.domElement;
    this._mv = (e) => { const r = cv.getBoundingClientRect(); this.mouse = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }; this._dirty = true; };
    this._lv = () => { this.mouse = null; this._dirty = true; };
    this._dn = (e) => { this._down = [e.clientX, e.clientY]; this.spinPause = performance.now() + 6000; this._fly = null; this.flying = false; };
    this._up = (e) => {
      const d = this._down; this._down = null; if (!d || e.button !== 0 || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 5) return;
      if (this.hover > 0 && this.hover <= this.data.notes.length && this.opts.onOpen) this.opts.onOpen(this.data.notes[this.hover - 1].id, e);
    };
    this._wh = () => { this.spinPause = performance.now() + 3000; this._fly = null; this.flying = false; };
    cv.addEventListener("pointermove", this._mv); cv.addEventListener("pointerleave", this._lv); cv.addEventListener("pointerdown", this._dn); cv.addEventListener("pointerup", this._up); cv.addEventListener("wheel", this._wh, { passive: true });
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.el);
  }

  resize() {
    const w = Math.max(this.el.clientWidth, 100), h = Math.max(this.el.clientHeight, 100);
    this.renderer.setSize(w, h); this.composer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.uniforms.uScale.value = h * 0.62; this.controls.handleResize && this.controls.handleResize();
  }

  focusSlot(slot) {
    const p = new THREE.Vector3().fromArray(this.pos, slot * 3);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize().multiplyScalar(24);
    this._fly = { t0: performance.now(), from: this.controls.target.clone(), to: p, cf: this.camera.position.clone(), ct: p.clone().add(dir) };
  }

  _pick() {
    if (!this.mouse) return -1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObject(this.points); let best = -1, bd = 1e9;
    for (const h of hits) { if (h.index === 0) continue; if (h.distanceToRay < bd) { bd = h.distanceToRay; best = h.index; } }
    return best;
  }

  _setHover(i) {
    const b = this.boostAttr.array, old = this.hover;
    if (old >= 0) { b[old] = 0; (this.adj.get(old) || []).forEach((n) => (b[n] = 0)); }
    this.hover = i;
    if (i >= 0) {
      b[i] = 1; const nb = this.adj.get(i) || []; nb.forEach((n) => (b[n] = 0.55));
      const lp = this.hoverGeo.attributes.position.array; let k = 0;
      for (const n of nb) { if (k >= 600) break; lp.set(this.pos.subarray(i * 3, i * 3 + 3), k * 6); lp.set(this.pos.subarray(n * 3, n * 3 + 3), k * 6 + 3); k++; }
      this.hoverGeo.attributes.position.needsUpdate = true; this.hoverGeo.setDrawRange(0, k * 2);
    } else this.hoverGeo.setDrawRange(0, 0);
    this.boostAttr.needsUpdate = true;
  }

  _project(slot, out) { out.fromArray(this.pos, slot * 3).project(this.camera); return out; }

  _loop(now) {
    if (!this.running) return;
    window.requestAnimationFrame(this._loop);
    if (document.hidden || !this.el.isConnected || this.el.clientWidth < 10 || (this.el.offsetParent === null && !this.opts.force)) return;
    // no frame cap: runs at the monitor's refresh. Only throttles when Obsidian is in the background (optional).
    if (this.s.saveGpu && !document.hasFocus() && now - this._last < 66) return;
    const dt = Math.min(100, now - (this._last || now)); this._last = now; this.frames++;
    if ((this._fpsT = (this._fpsT || now)) && now - this._fpsT > 500) { this.fpsEl.textContent = Math.round((this.frames - (this._fpsF || 0)) * 1000 / (now - this._fpsT)) + " fps"; this._fpsT = now; this._fpsF = this.frames; }
    const t = (now - this.t0) / 1000; this.uniforms.uTime.value = this.reduced ? 0 : t;
    const cam = this.camera, c = this.controls;
    if (this.flying) { const k = (now - this.flyStart) / 2600; cam.position.lerpVectors(this.home.clone().multiplyScalar(2.6), this.home, ease(k)); if (k >= 1) this.flying = false; }
    if (this._fly) { const k = ease((now - this._fly.t0) / 900); c.target.lerpVectors(this._fly.from, this._fly.to, k); cam.position.lerpVectors(this._fly.cf, this._fly.ct, k); if (k >= 1) this._fly = null; }
    if (!this.reduced && this.s.spin > 0 && now > this.spinPause && !this._down) {
      const q = (this._q = this._q || new THREE.Quaternion()), off = (this._off = this._off || new THREE.Vector3());
      q.setFromAxisAngle(cam.up, this.s.spin * 0.12 * (dt / 1000)); off.copy(cam.position).sub(c.target).applyQuaternion(q); cam.position.copy(c.target).add(off);
    }
    c.update();
    this.core.scale.setScalar(this.coreSize * (1 + (this.s.pulse && !this.reduced ? Math.sin(t * 1.3) * 0.04 : 0)));
    if (this._dirty || this.hover >= 0) { const p = this._pick(); if (p !== this.hover) this._setHover(p); this._dirty = false; }
    const w = this.el.clientWidth, h = this.el.clientHeight, tmp = (this._tmp = this._tmp || new THREE.Vector3()), hv = (this._hv = this._hv || new THREE.Vector3());
    if (this.hover > 0 && this.hover <= this.data.notes.length && this.mouse) {
      const n = this.data.notes[this.hover - 1]; this._project(this.hover, tmp); this.tip.classList.remove("is-hidden");
      this.tip.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w + 14}px,${(-tmp.y * 0.5 + 0.5) * h - 10}px)`;
      if (this.tip._n !== this.hover) { this.tip.replaceChildren(); const b = document.createElement("b"), sp = document.createElement("span"); b.textContent = n.name; sp.textContent = n.group; this.tip.append(b, sp); this.tip._n = this.hover; }
    } else this.tip.classList.add("is-hidden");
    if (this.s.labels) {
      const zf = Math.min(1, Math.max(0, (this.far * 3.2 - cam.position.distanceTo(c.target)) / (this.far * 1.6)));
      this.groupInfo.forEach((g, i) => {
        const e = this.hubLabels[i]; this._project(g.slot, tmp); const cd = cam.position.distanceTo(hv.fromArray(this.pos, g.slot * 3));
        const show = (i < 9 || cd < 70) && zf > 0.02;
        if (tmp.z > 1 || tmp.z < -1 || !show) { e.classList.add("is-off"); return; }
        e.style.opacity = (i < 9 ? 1 : Math.min(1, (70 - cd) / 25)) * zf; e.classList.remove("is-off");
        e.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w}px,${(-tmp.y * 0.5 + 0.5) * h}px) translate(-50%,-135%)`;
      });
    }
    const nb = Math.min(MAX_BEADS, Math.round(this.s.beads));
    if (!this.reduced && nb > 0 && this.edges.length) {
      const bp = this.beadPts.geometry.attributes.position.array, P = this.pos, sp = this.s.beadSpeed * dt / 1000;
      for (let i = 0; i < nb; i++) {
        const b = this.beads[i]; b.t += b.s * sp; if (b.t > 1) { b.t = 0; b.e = this.edges[(Math.random() * this.edges.length) | 0]; }
        const a = b.e[0] * 3, e2 = b.e[1] * 3, k = b.t;
        bp[i * 3] = P[a] + (P[e2] - P[a]) * k; bp[i * 3 + 1] = P[a + 1] + (P[e2 + 1] - P[a + 1]) * k; bp[i * 3 + 2] = P[a + 2] + (P[e2 + 2] - P[a + 2]) * k;
      }
      this.beadPts.geometry.attributes.position.needsUpdate = true;
    }
    if (!this.reduced) {
      const k = this.coreSize * 0.5;
      this.halos.forEach((l) => { l.scale.setScalar(k * l.userData.k); l.rotateOnAxis(l.userData.ax, l.userData.sp * dt / 1000); });
      if (this.s.comets && this.s.rings > 0) for (const cm of this.comets) {
        cm.ph = (cm.ph + cm.sp * dt / 1000 + 1) % 1; const seg = cm.lp.length / 3, head = Math.floor(cm.ph * seg), dir = cm.sp > 0 ? 1 : -1;
        const P = cm.line.geometry.attributes.position.array, C = cm.line.geometry.attributes.color.array, col = this.color, br = Math.min(2, 0.6 + this.s.rings * 0.7);
        for (let j = 0; j < cm.TL; j++) {
          const idx = ((head - j * dir) % seg + seg) % seg; P[j * 3] = cm.lp[idx * 3]; P[j * 3 + 1] = cm.lp[idx * 3 + 1]; P[j * 3 + 2] = cm.lp[idx * 3 + 2];
          const f = Math.pow(1 - j / cm.TL, 2) * br, w = j < 2 ? 0.5 : 0;
          C[j * 3] = Math.min(1, col.r * f + w); C[j * 3 + 1] = Math.min(1, col.g * f + w); C[j * 3 + 2] = Math.min(1, col.b * f + w);
        }
        cm.line.geometry.attributes.position.needsUpdate = true; cm.line.geometry.attributes.color.needsUpdate = true;
      }
    } else this.halos.forEach((l) => l.scale.setScalar(this.coreSize * 0.5 * l.userData.k));
    this.composer.render();
  }

  destroy() {
    this.running = false; window.clearTimeout(this._saveT); this.ro && this.ro.disconnect(); this.controls.dispose();
    this.scene.traverse((o) => { o.geometry && o.geometry.dispose(); if (o.material) { o.material.map && o.material.map.dispose(); o.material.dispose(); } });
    this.composer.dispose && this.composer.dispose(); this.renderer.dispose(); this.root.remove();
  }
}
