/* =========================================================
   HeliHop 3D — procedural helicopter (Three.js r180)
   Intro (start-up → take-off → fly to hero pose), hero hover,
   showcase turntable stage. ES module; exposes window.HH3D.
   ========================================================= */
import * as THREE from './vendor/three.module.min.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';

const G = () => window.gsap;
const mobileDevice = () => innerWidth < 1024 || /Mobi|Android/i.test(navigator.userAgent);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

/* ---------------- canvas textures ---------------- */
function cnv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, srgb = true) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function glowTexture() {
  const c = cnv(128, 128), x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, 'rgba(255,255,255,.55)'); g.addColorStop(.6, 'rgba(255,255,255,.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); return tex(c, false);
}
function ringTexture() {
  const c = cnv(512, 512), x = c.getContext('2d');
  const g = x.createRadialGradient(256, 256, 0, 256, 256, 256);
  g.addColorStop(0, 'rgba(180,190,200,0)'); g.addColorStop(.12, 'rgba(180,190,200,.05)'); g.addColorStop(.55, 'rgba(190,198,206,.5)'); g.addColorStop(.9, 'rgba(200,206,212,.6)'); g.addColorStop(1, 'rgba(200,206,212,0)');
  x.fillStyle = g; x.fillRect(0, 0, 512, 512); return tex(c, false);
}
function shadowTexture() {
  const c = cnv(256, 256), x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,.75)'); g.addColorStop(.45, 'rgba(0,0,0,.4)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256); return tex(c, false);
}
function padTexture() {
  const S = 1024, c = cnv(S, S), x = c.getContext('2d');
  x.fillStyle = '#121417'; x.fillRect(0, 0, S, S);
  // asphalt noise
  const img = x.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() * 14) | 0; d[i] += n; d[i + 1] += n; d[i + 2] += n + 2; }
  x.putImageData(img, 0, 0);
  x.translate(S / 2, S / 2);
  x.strokeStyle = 'rgba(255,255,255,.92)'; x.lineWidth = 16; x.beginPath(); x.arc(0, 0, S * .44, 0, Math.PI * 2); x.stroke();
  x.setLineDash([26, 22]); x.lineWidth = 4; x.strokeStyle = 'rgba(255,255,255,.35)'; x.beginPath(); x.arc(0, 0, S * .30, 0, Math.PI * 2); x.stroke(); x.setLineDash([]);
  x.fillStyle = 'rgba(255,255,255,.9)'; x.font = `900 ${S * .42}px Unbounded, Manrope, Arial, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('H', 0, S * .02);
  for (let i = 0; i < 36; i++) { x.save(); x.rotate((i / 36) * Math.PI * 2); x.fillStyle = 'rgba(255,255,255,.5)'; x.fillRect(-2, -S * .485, 4, 14); x.restore(); }
  return tex(c);
}
function roundRect(ctx, x0, y0, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x0 + r, y0); ctx.lineTo(x0 + w - r, y0); ctx.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  ctx.lineTo(x0 + w, y0 + h - r); ctx.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  ctx.lineTo(x0 + r, y0 + h); ctx.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  ctx.lineTo(x0, y0 + r); ctx.quadraticCurveTo(x0, y0, x0 + r, y0); ctx.closePath();
}
/** Fuselage livery painted in UV space: x = along body (tail→nose), y = around (0 port, .25 belly, .5 starboard, .75 roof) */
const BODY_X0 = -7.25, BODY_LEN = 10.11;
function bodyTextures() {
  const W = 2048, H = 1024;
  const c = cnv(W, H), x = c.getContext('2d');
  const rC = cnv(W, H), rx = rC.getContext('2d');
  const mC = cnv(W, H), mx = mC.getContext('2d');
  const X = (m) => (m - BODY_X0) / BODY_LEN * W, Y = (u) => u * H;
  x.fillStyle = '#f3f5f7'; x.fillRect(0, 0, W, H);
  rx.fillStyle = 'rgb(84,84,84)'; rx.fillRect(0, 0, W, H);
  mx.fillStyle = 'rgb(26,26,26)'; mx.fillRect(0, 0, W, H);
  const glass = (x0, y0, w, h, r) => {
    [[x, '#0a1319'], [rx, 'rgb(12,12,12)'], [mx, 'rgb(150,150,150)']].forEach(([ctx, col]) => { ctx.fillStyle = col; ctx.beginPath(); roundRect(ctx, x0, y0, w, h, r); ctx.fill(); });
    // frame line
    x.strokeStyle = 'rgba(14,16,20,.9)'; x.lineWidth = 6; x.beginPath(); roundRect(x, x0, y0, w, h, r); x.stroke();
  };
  // windscreen bubble (starboard-upper → roof → port-upper)
  glass(X(.42), Y(.505), X(2.72) - X(.42), Y(.995) - Y(.505), 90);
  // chin windows
  glass(X(1.7), Y(.035), X(2.72) - X(1.7), Y(.2) - Y(.035), 40);
  glass(X(1.7), Y(.3), X(2.72) - X(1.7), Y(.465) - Y(.3), 40);
  // cabin side windows (port upper / starboard upper) + rear quarter windows
  glass(X(-1.5), Y(.795), X(.34) - X(-1.5), Y(.975) - Y(.795), 46);
  glass(X(-1.5), Y(.525), X(.34) - X(-1.5), Y(.705) - Y(.525), 46);
  glass(X(-2.1), Y(.815), X(-1.58) - X(-2.1), Y(.955) - Y(.815), 30);
  glass(X(-2.1), Y(.545), X(-1.58) - X(-2.1), Y(.685) - Y(.545), 30);
  // door seams + panel lines
  x.strokeStyle = 'rgba(20,24,30,.5)'; x.lineWidth = 3;
  [.38, -1.54, -2.15].forEach((m) => { x.beginPath(); x.moveTo(X(m), Y(.27)); x.lineTo(X(m), Y(.99)); x.stroke(); x.beginPath(); x.moveTo(X(m), Y(.01)); x.lineTo(X(m), Y(.23)); x.stroke(); });
  x.strokeStyle = 'rgba(20,24,30,.22)'; x.lineWidth = 2;
  [-6.3, -4.6].forEach((m) => { x.beginPath(); x.moveTo(X(m), 0); x.lineTo(X(m), H); x.stroke(); });
  // belly stripes (both sides)
  x.fillStyle = '#0b0d11';
  x.fillRect(X(-6.7), Y(.112), X(1.3) - X(-6.7), Y(.132) - Y(.112));
  x.fillRect(X(-6.7), Y(.368), X(1.3) - X(-6.7), Y(.388) - Y(.368));
  // livery text on the boom
  const logo = (cy, flip) => {
    x.save(); x.translate(X(-3.45), cy); if (flip) x.scale(-1, -1);
    x.fillStyle = '#0b0d11'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = 'italic 900 92px Unbounded, Manrope, Arial, sans-serif'; x.fillText('HELIHOP', 0, -6);
    x.font = '700 28px Manrope, Arial, sans-serif'; x.fillStyle = 'rgba(11,13,17,.72)'; x.fillText('KYRGYZSTAN  ·  BISHKEK', 0, 56);
    x.restore();
  };
  logo(Y(.925), false); logo(Y(.575), true);
  // registration on the tail
  x.save(); x.fillStyle = '#0b0d11'; x.font = '800 40px Manrope, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('EX-125', X(-6.0), Y(.93)); x.save(); x.translate(X(-6.0), Y(.57)); x.scale(-1, -1); x.fillText('EX-125', 0, 0); x.restore(); x.restore();
  const T = (canvas, srgb) => { const t = tex(canvas, srgb); t.flipY = false; t.anisotropy = 8; return t; };
  return { map: T(c, true), roughnessMap: T(rC, false), metalnessMap: T(mC, false) };
}

/* ---------------- geometry helpers ---------------- */
function filterGeometry(src, keep) {
  const g = src.index ? src.toNonIndexed() : src.clone();
  const p = g.attributes.position, out = [], n = p.count;
  for (let i = 0; i < n; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    if (keep(cx, cy, cz)) for (let k = 0; k < 3; k++) out.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  geo.computeVertexNormals();
  return geo;
}
function tube(points, r = .05, segs = 32) { return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), segs, r, 10, false); }

/* ---------------- materials ---------------- */
function makeMaterials() {
  return {
    paint: new THREE.MeshPhysicalMaterial({ color: 0xf2f4f6, metalness: .12, roughness: .3, clearcoat: 1, clearcoatRoughness: .1, envMapIntensity: 1.25 }),
    body: (() => { const t = bodyTextures(); return new THREE.MeshPhysicalMaterial({ map: t.map, roughnessMap: t.roughnessMap, metalnessMap: t.metalnessMap, roughness: 1, metalness: 1, clearcoat: 1, clearcoatRoughness: .08, envMapIntensity: 1.3 }); })(),
    dark: new THREE.MeshStandardMaterial({ color: 0x14171b, metalness: .55, roughness: .55, envMapIntensity: .9 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0b0d10, metalness: .3, roughness: .75 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xbfc5cc, metalness: 1, roughness: .28, envMapIntensity: 1.4 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0c1720, metalness: .35, roughness: .06, clearcoat: 1, clearcoatRoughness: .04, envMapIntensity: 1.8, transparent: true, opacity: .94 }),
    blade: new THREE.MeshStandardMaterial({ color: 0x1b1e23, metalness: .45, roughness: .6, transparent: true, opacity: 1 }),
    pad: new THREE.MeshStandardMaterial({ map: padTexture(), roughness: .92, metalness: .05, transparent: true }),
  };
}

/* ---------------- helicopter ---------------- */
export function buildHelicopter(m) {
  const g = new THREE.Group();
  const add = (geo, mat, pos, rot, scale) => { const mesh = new THREE.Mesh(geo, mat); if (pos) mesh.position.set(...pos); if (rot) mesh.rotation.set(...rot); if (scale) mesh.scale.set(...scale); g.add(mesh); return mesh; };

  // --- fuselage: smooth resampled profile, lathe along X, sculpted, UV = (along, around) ---
  const ctrl = [[-7.25, 0], [-7.2, .1], [-6.9, .15], [-6.2, .185], [-5.3, .225], [-4.4, .27], [-3.4, .32], [-2.6, .39], [-2.05, .53], [-1.65, .78], [-1.15, 1.04], [-.55, 1.2], [.2, 1.25], [.9, 1.21], [1.6, 1.09], [2.15, .88], [2.55, .58], [2.8, .25], [2.86, 0]];
  const curve = new THREE.CatmullRomCurve3(ctrl.map(([px, r]) => new THREE.Vector3(px, r, 0)), false, 'centripetal');
  const samples = curve.getPoints(900);
  const N = 140, pts = [];
  for (let i = 0; i < N; i++) {
    const px = BODY_X0 + (i / (N - 1)) * BODY_LEN;
    let best = samples[0]; for (const sp of samples) { if (Math.abs(sp.x - px) < Math.abs(best.x - px)) best = sp; }
    const r = (i === 0 || i === N - 1) ? 0 : Math.max(.02, best.y);
    pts.push(new THREE.Vector2(r, px));
  }
  const lathe = new THREE.LatheGeometry(pts, 96);
  const uv = lathe.attributes.uv;
  for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v, u); }
  lathe.rotateZ(-Math.PI / 2);
  const pos = lathe.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (x > -1.9) { if (y < 0) y *= .82; else y *= 1.1; z *= .93; }
    if (x < -1.9) y += (-1.9 - x) * .07;
    pos.setXYZ(i, x, y, z);
  }
  lathe.computeVertexNormals();
  const body = add(lathe, m.body);
  // engine cowling + intake + exhaust
  const cowl = new THREE.CapsuleGeometry(.52, 1.4, 6, 20); cowl.rotateZ(Math.PI / 2);
  add(cowl, m.paint, [-.75, 1.14, 0], null, [1, .72, 1.08]);
  add(new THREE.BoxGeometry(.46, .14, .7, 2, 2, 2), m.dark, [.12, 1.27, 0]);
  add(new THREE.CylinderGeometry(.13, .15, .55, 16), m.dark, [-1.95, 1.18, .3], [0, 0, Math.PI / 2 + .35]);
  // mast + rotor head
  add(new THREE.CylinderGeometry(.09, .1, .62, 16), m.dark, [-.15, 1.66, 0]);
  add(new THREE.CylinderGeometry(.3, .33, .16, 24), m.dark, [-.15, 1.96, 0]);
  add(new THREE.CylinderGeometry(.44, .44, .06, 6), m.chrome, [-.15, 2.05, 0]);
  add(new THREE.CylinderGeometry(.08, .12, .16, 12), m.chrome, [-.15, 2.14, 0]);
  // main rotor
  const rotor = new THREE.Group(); rotor.position.set(-.15, 2.06, 0); g.add(rotor);
  for (let k = 0; k < 3; k++) {
    const b = new THREE.Group(); b.rotation.y = (k / 3) * Math.PI * 2; rotor.add(b);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(5.2, .05, .36, 6, 1, 1), m.blade); blade.position.x = 2.95; blade.rotation.x = .08; blade.rotation.z = -.025; b.add(blade);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(.42, .054, .37), m.paint); tip.position.x = 5.35; tip.rotation.x = .08; tip.rotation.z = -.025; b.add(tip);
    const root = new THREE.Mesh(new THREE.BoxGeometry(.5, .1, .2), m.chrome); root.position.x = .45; b.add(root);
  }
  const blur = new THREE.Mesh(new THREE.CircleGeometry(5.7, 64), new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, color: 0xd0d6dc }));
  blur.rotation.x = -Math.PI / 2; blur.position.set(-.15, 2.08, 0); g.add(blur);
  // tail: fins, stabilizer
  const finShape = new THREE.Shape(); finShape.moveTo(-6.42, .3); finShape.lineTo(-6.22, 1.6); finShape.lineTo(-6.7, 1.72); finShape.lineTo(-7.18, .32); finShape.closePath();
  add(new THREE.ExtrudeGeometry(finShape, { depth: .09, bevelEnabled: true, bevelThickness: .015, bevelSize: .015, bevelSegments: 2 }), m.paint, [0, 0, -.045]);
  const vfin = new THREE.Shape(); vfin.moveTo(-6.5, -.05); vfin.lineTo(-6.78, -.98); vfin.lineTo(-7.12, -.98); vfin.lineTo(-7.22, -.05); vfin.closePath();
  add(new THREE.ExtrudeGeometry(vfin, { depth: .07, bevelEnabled: false }), m.paint, [0, 0, -.035]);
  add(new THREE.BoxGeometry(.62, .06, 2.3), m.paint, [-5.75, .45, 0]);
  add(new THREE.BoxGeometry(.62, .55, .05), m.paint, [-5.75, .45, 1.15]);
  add(new THREE.BoxGeometry(.62, .55, .05), m.paint, [-5.75, .45, -1.15]);
  // tail rotor
  const tail = new THREE.Group(); tail.position.set(-6.95, 1.02, -.34); g.add(tail);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, .14, 12), m.dark); hub.rotation.x = Math.PI / 2; tail.add(hub);
  const tb1 = new THREE.Mesh(new THREE.BoxGeometry(.16, 1.9, .03), m.blade); tail.add(tb1);
  const tb2 = new THREE.Mesh(new THREE.BoxGeometry(1.9, .16, .03), m.blade); tail.add(tb2);
  const tblur = new THREE.Mesh(new THREE.CircleGeometry(.98, 32), new THREE.MeshBasicMaterial({ map: blur.material.map, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, color: 0xd0d6dc }));
  tblur.position.set(-6.95, 1.02, -.36); g.add(tblur);
  // skids
  for (const z of [-.98, .98]) add(tube([[-2.25, -1.52, z], [-1.2, -1.55, z], [.6, -1.55, z], [2.0, -1.55, z], [2.55, -1.42, z], [2.9, -1.15, z]], .05), m.black);
  for (const x of [-1.05, 1.3]) add(tube([[x, -1.52, -.98], [x, -1.15, -.75], [x, -.92, 0], [x, -1.15, .75], [x, -1.52, .98]], .045, 24), m.black);
  for (const z of [-.98, .98]) add(new THREE.BoxGeometry(.9, .06, .2), m.black, [.1, -1.32, z * .9]);
  // antennas
  add(new THREE.CylinderGeometry(.012, .016, .38, 6), m.black, [-3.4, .62, 0]);
  add(new THREE.CylinderGeometry(.014, .014, .3, 6), m.black, [-2.7, -.6, 0]);
  // lights
  const glowMap = glowTexture();
  const light = (color, p, size = .9) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(.055, 12, 12), new THREE.MeshBasicMaterial({ color })); s.position.set(...p); g.add(s);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); sp.scale.setScalar(size); sp.position.set(...p); g.add(sp);
    return { mesh: s, sprite: sp, on: 0 };
  };
  const lights = {
    navL: light(0xff2a2a, [.35, .02, 1.16]), navR: light(0x2aff6a, [.35, .02, -1.16]),
    beacon: light(0xff3030, [-1.15, 1.58, 0], 1.3), strobe: light(0xffffff, [-6.62, 1.78, 0], 1.1),
    landing: light(0xfff4d6, [2.35, -.66, 0], 2.2),
  };
  const state = { rpm: 0, blur: 0, vib: 0 };
  const api = {
    group: g, rotor, tail, blur, tblur, lights, state, body,
    setRPM(v) { state.rpm = v; },
    update(dt, t) {
      rotor.rotation.y += state.rpm * 34 * dt;
      tail.rotation.z += state.rpm * 160 * dt;
      blur.material.opacity = state.blur * .95; tblur.material.opacity = state.blur * .8;
      m.blade.opacity = 1 - state.blur * .7;
      const beaconOn = (t % 1.1) < .09 || ((t % 1.1) > .2 && (t % 1.1) < .27);
      const strobeOn = (t % 1.5) < .05 || ((t % 1.5) > .14 && (t % 1.5) < .19);
      const set = (l, on) => { l.sprite.material.opacity = lerp(l.sprite.material.opacity, on ? 1 : 0, on ? .6 : .35); l.mesh.material.color.setScalar(on ? 1 : .35).multiply(l.sprite.material.color); };
      set(lights.beacon, beaconOn && state.lightsOn); set(lights.strobe, strobeOn && state.lightsOn);
      set(lights.navL, state.lightsOn); set(lights.navR, state.lightsOn);
      set(lights.landing, state.landingOn);
    },
  };
  state.lightsOn = false; state.landingOn = false;
  return api;
}

/* ---------------- stage ---------------- */
export class HeliStage {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.mobile = opts.mobile != null ? opts.mobile : mobileDevice();
    this.mode = opts.mode || 'hero';
    this.poseOffset = opts.poseOffset || [0, 0, 0];
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !this.mobile, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.mobile ? 1.6 : 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.02;
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;
    const scene = this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
    pmrem.dispose();
    this.camera = new THREE.PerspectiveCamera(32, 1, .1, 400);
    const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(9, 14, 10); scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfe1ff, 2.0); rim.position.set(-12, 7, -9); scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffffff, .6); fill.position.set(-6, 2, 12); scene.add(fill);
    this.mats = makeMaterials();
    this.heli = buildHelicopter(this.mats);
    scene.add(this.heli.group);
    // ground shadow + pad
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, opacity: 0, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = -1.57; scene.add(this.shadow);
    this.pad = new THREE.Mesh(new THREE.CircleGeometry(6.6, 72), this.mats.pad);
    this.pad.rotation.x = -Math.PI / 2; this.pad.position.y = -1.6; this.pad.visible = false; scene.add(this.pad);
    this.padLights = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const l = new THREE.Mesh(new THREE.SphereGeometry(.09, 10, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      l.position.set(Math.cos(a) * 6.3, -1.52, Math.sin(a) * 6.3); l.visible = false; scene.add(l); this.padLights.push(l);
    }
    // dust particles
    const N = this.mobile ? 160 : 320, pts = new Float32Array(N * 3), seeds = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { const a = Math.random() * Math.PI * 2, r = 2.5 + Math.random() * 4; pts[i * 3] = Math.cos(a) * r; pts[i * 3 + 1] = -1.55 + Math.random() * 1.2; pts[i * 3 + 2] = Math.sin(a) * r; seeds[i * 2] = a; seeds[i * 2 + 1] = r; }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.dustSeeds = seeds;
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: .16, map: glowTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xaeb6bf, sizeAttenuation: true }));
    this.dust.visible = false; scene.add(this.dust);
    // trail line
    this.trail = null;
    // state
    this.t = 0; this.last = performance.now();
    this.visible = true; this.running = false; this.needsResize = true;
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.hover = { amount: 0, base: new THREE.Vector3(), yaw: 0, scroll: 0 };
    this.showcase = { p: 0, drag: 0, dragV: 0 };
    this.lookAt = new THREE.Vector3(0, .5, 0);
    this.camTarget = { pos: new THREE.Vector3(0, 1.6, 17), look: new THREE.Vector3(0, .4, 0) };
    this.camera.position.copy(this.camTarget.pos);
    this.ro = new ResizeObserver(() => { this.needsResize = true; });
    this.ro.observe(canvas.parentElement || canvas);
    this.io = new IntersectionObserver((en) => { this.visible = en[0].isIntersecting; }, { threshold: 0 });
    this.io.observe(canvas);
    this.onVis = () => { if (!document.hidden) this.last = performance.now(); };
    document.addEventListener('visibilitychange', this.onVis);
    this.resize();
    this.frame = this.frame.bind(this);
  }
  resize() {
    const el = this.canvas.parentElement || this.canvas;
    const w = Math.max(2, el.clientWidth), h = Math.max(2, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = this.camera.aspect < .8 ? 46 : this.camera.aspect < 1.2 ? 38 : 32;
    this.camera.updateProjectionMatrix();
    this.needsResize = false;
  }
  attachTo(el) { el.appendChild(this.canvas); this.ro.disconnect(); this.ro.observe(el); this.needsResize = true; this.resize(); }
  setPointer(x, y) { this.pointer.tx = clamp(x, -1, 1); this.pointer.ty = clamp(y, -1, 1); }
  setScroll(p) { this.hover.scroll = clamp(p, 0, 1); }
  heroPose() {
    const m = this.mobile;
    const o = this.poseOffset;
    return { pos: new THREE.Vector3((m ? 1.9 : 4.1) + o[0], (m ? 4.4 : 1.2) + o[1], (m ? -1 : -.5) + o[2]), yaw: Math.PI + .62, scale: m ? .62 : .96, cam: new THREE.Vector3(0, 1.6, 17), look: new THREE.Vector3(0, .4, 0) };
  }
  padPose() { return { cam: new THREE.Vector3(10.8, 3.4, 12.8), look: new THREE.Vector3(.4, .8, 0) }; }
  start() { if (this.running) return; this.running = true; this.last = performance.now(); requestAnimationFrame(this.frame); }
  stop() { this.running = false; }
  frame(now) {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    let dt = (now - this.last) / 1000; this.last = now;
    if (dt > .1) dt = .1;
    if (!this.visible || document.hidden) return;
    this.t += dt;
    if (this.needsResize) this.resize();
    const h = this.heli, st = h.state, g = h.group;
    this.pointer.x = lerp(this.pointer.x, this.pointer.tx, .06); this.pointer.y = lerp(this.pointer.y, this.pointer.ty, .06);
    // hover behaviour blends in via hover.amount
    if (this.hover.amount > 0) {
      const a = this.hover.amount, s = this.hover.scroll, sc = smooth(s);
      const bob = Math.sin(this.t * 1.15) * .12 + Math.sin(this.t * 2.3) * .03;
      const px = this.pointer.x, py = this.pointer.y;
      const target = new THREE.Vector3().copy(this.hover.base).add(new THREE.Vector3(-3.5 * sc, 7.5 * sc, -14 * sc));
      target.y += bob * a; target.x += px * .6 * a; target.y += -py * .35 * a;
      g.position.lerp(target, a >= 1 ? .12 : a);
      const yaw = this.hover.yaw + px * .22 * a, roll = -px * .3 * a + Math.sin(this.t * .8) * .025 * a, pitch = py * .12 * a - .3 * sc;
      g.rotation.y = lerp(g.rotation.y, yaw, .08); g.rotation.x = lerp(g.rotation.x, roll, .08); g.rotation.z = lerp(g.rotation.z, pitch, .08);
    }
    // showcase turntable
    if (this.mode === 'showcase') {
      this.showcase.drag += this.showcase.dragV; this.showcase.dragV *= .93;
      g.rotation.y = lerp(g.rotation.y, .6 + this.showcase.p * Math.PI * 1.35 + this.showcase.drag, .1);
      g.position.y = Math.sin(this.t * .9) * .06;
      const kf = this.mobile ? [[13, 4.5, 13, -.6, .3, 0], [6.6, 1.2, 8.8, 1.1, .5, 0], [1.5, 8.8, 5.8, -.3, 1.8, 0], [-9.5, -1.1, 10.5, -2.8, -.5, 0]] : [[12.5, 4.2, 12.5, 0, .3, 0], [6.2, 1.1, 8.4, 1.6, .5, 0], [1.5, 8.5, 5.5, -.3, 1.9, 0], [-9.5, -1.2, 10.5, -3.2, -.5, 0]];
      const p = this.showcase.p * 3, i = Math.min(2, Math.floor(p)), f = smooth(clamp(p - i, 0, 1)), A = kf[i], B = kf[i + 1];
      this.camTarget.pos.set(lerp(A[0], B[0], f), lerp(A[1], B[1], f), lerp(A[2], B[2], f));
      this.camTarget.look.set(lerp(A[3], B[3], f), lerp(A[4], B[4], f), lerp(A[5], B[5], f));
    }
    // vibration (engine running, on ground)
    if (st.vib > 0) { const v = st.vib * st.rpm * .012; g.position.x += (Math.random() - .5) * v; g.position.z += (Math.random() - .5) * v; g.rotation.z += (Math.random() - .5) * v * .5; }
    // dust
    if (this.dust.visible && this.dust.material.opacity > 0) {
      const p = this.dust.geometry.attributes.position, s = this.dustSeeds, n = p.count;
      for (let i = 0; i < n; i++) { const a = s[i * 2] + this.t * (.35 + (i % 5) * .05), r = s[i * 2 + 1] + Math.sin(this.t * .7 + i) * .4; p.setX(i, Math.cos(a) * r); p.setZ(i, Math.sin(a) * r); p.setY(i, -1.5 + ((this.t * .6 + i * .37) % 1.4)); }
      p.needsUpdate = true;
    }
    // pad lights pulse
    if (this.pad.visible) { const k = .55 + .45 * Math.sin(this.t * 2.2); this.padLights.forEach((l, i) => { l.material.color.setScalar(.6 + .4 * Math.sin(this.t * 2.2 + i * .4)); l.visible = this.pad.material.opacity > .05; }); this.mats.pad.emissive && (this.mats.pad.emissiveIntensity = k); }
    h.update(dt, this.t);
    // camera easing
    this.camera.position.lerp(this.camTarget.pos, .08);
    this.lookAt.lerp(this.camTarget.look, .08);
    this.camera.lookAt(this.lookAt);
    this.renderer.render(this.scene, this.camera);
  }
  /* -------- poses -------- */
  applyHero(instant = false) {
    const P = this.heroPose(); const g = this.heli.group;
    this.hover.base.copy(P.pos); this.hover.yaw = P.yaw;
    g.scale.setScalar(P.scale);
    this.camTarget.pos.copy(P.cam); this.camTarget.look.copy(P.look);
    if (instant) { g.position.copy(P.pos); g.rotation.set(0, P.yaw, 0); this.camera.position.copy(P.cam); this.lookAt.copy(P.look); this.hover.amount = 1; }
    this.heli.state.rpm = 1; this.heli.state.blur = .58; this.heli.state.lightsOn = true; this.heli.state.vib = 0;
    this.mode = 'hero';
  }
  /* -------- intro: engine start, take-off, fly to hero pose -------- */
  intro({ onReveal, onDone, short = false } = {}) {
    const gs = G(), g = this.heli.group, st = this.heli.state, P = this.heroPose(), pad = this.padPose();
    g.scale.setScalar(P.scale);
    const tl = gs.timeline({ onComplete: () => { this.hover.amount = 1; onDone && onDone(); } });
    this.tl = tl;
    if (short) {
      // returning visitor: quick fly-in from bottom-left
      st.rpm = 1; st.blur = .58; st.lightsOn = true;
      const from = new THREE.Vector3(P.pos.x - 14, P.pos.y - 6, P.pos.z + 4);
      g.position.copy(from); g.rotation.set(.25, P.yaw - .5, -.2);
      this.camera.position.copy(P.cam); this.lookAt.copy(P.look); this.camTarget.pos.copy(P.cam); this.camTarget.look.copy(P.look);
      this.hover.base.copy(P.pos); this.hover.yaw = P.yaw;
      tl.to(g.position, { x: P.pos.x, y: P.pos.y, z: P.pos.z, duration: 1.7, ease: 'power3.out' }, 0)
        .to(g.rotation, { x: 0, y: P.yaw, z: 0, duration: 1.9, ease: 'power3.out' }, 0)
        .call(() => onReveal && onReveal(), null, .15)
        .to(this.hover, { amount: 1, duration: .8 }, 1.2);
      this.mode = 'hero';
      return tl;
    }
    // --- full sequence ---
    this.pad.visible = true; this.pad.material.opacity = 1; this.shadow.material.opacity = .85; this.dust.visible = true;
    g.position.set(0, 0, 0); g.rotation.set(0, 0, 0);
    st.rpm = 0; st.blur = 0; st.lightsOn = false; st.landingOn = false; st.vib = 0;
    this.camera.position.copy(pad.cam); this.lookAt.copy(pad.look); this.camTarget.pos.copy(pad.cam); this.camTarget.look.copy(pad.look);
    // flight curve: pad → hero pose
    const path = new THREE.CatmullRomCurve3([new THREE.Vector3(0, .9, 0), new THREE.Vector3(-2.5, 2.6, 3.5), new THREE.Vector3(-1.5, 6.2, 1.5), new THREE.Vector3(2.5, 5.5, -3), P.pos.clone()]);
    const flight = { u: 0 };
    const yaw0 = 0, yaw1 = P.yaw;
    tl.call(() => { st.lightsOn = true; }, null, .35)
      .to(st, { rpm: 1, duration: 2.3, ease: 'power2.in' }, .35)
      .to(st, { vib: 1, duration: 1.2 }, .6)
      .to(st, { blur: .58, duration: 1.4, ease: 'power2.in' }, 1.2)
      .call(() => { st.landingOn = true; }, null, 1.5)
      .to(this.dust.material, { opacity: .75, duration: 1.0 }, 1.4)
      .to(st, { vib: 0, duration: .8 }, 2.5)
      .to(g.position, { y: .9, duration: 1.1, ease: 'power2.inOut' }, 2.55)
      .to(g.rotation, { x: -.07, z: -.05, duration: 1.1, ease: 'power2.inOut' }, 2.55)
      .to(this.shadow.material, { opacity: 0, duration: 1.1 }, 2.7)
      .to(this.dust.material, { opacity: 0, duration: 1.0 }, 2.9)
      .to(flight, { u: 1, duration: 2.9, ease: 'power2.inOut', onUpdate: () => {
        const u = flight.u; const p = path.getPoint(u); g.position.copy(p);
        const tan = path.getTangent(u);
        const heading = Math.atan2(-tan.z, tan.x);
        const blend = smooth(clamp((u - .55) / .45, 0, 1));
        let yaw = heading; // fly along the path
        // unwrap toward final yaw
        const target = yaw1; let d = target - yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
        yaw = yaw + d * blend;
        g.rotation.y = yaw;
        g.rotation.x = -Math.sin(u * Math.PI) * .38 * (1 - blend) + (1 - blend) * -.05;
        g.rotation.z = -.28 * Math.sin(u * Math.PI) * (1 - blend);
      } }, 3.5)
      .to(this.camTarget.pos, { x: P.cam.x, y: P.cam.y, z: P.cam.z, duration: 2.6, ease: 'power2.inOut' }, 3.6)
      .to(this.camTarget.look, { x: P.look.x, y: P.look.y, z: P.look.z, duration: 2.6, ease: 'power2.inOut' }, 3.6)
      .to(this.pad.material, { opacity: 0, duration: .9, onComplete: () => { this.pad.visible = false; this.dust.visible = false; } }, 3.3)
      .call(() => { st.landingOn = false; }, null, 4.4)
      .call(() => onReveal && onReveal(), null, 4.25)
      .call(() => { this.hover.base.copy(P.pos); this.hover.yaw = P.yaw; this.mode = 'hero'; this.dust.visible = false; this.pad.visible = false; this.dust.material.opacity = 0; this.padLights.forEach((l) => { l.visible = false; }); }, null, 6.3)
      .to(this.hover, { amount: 1, duration: 1.2, ease: 'power1.inOut' }, 6.35);
    return tl;
  }
  skipIntro() { if (this.tl && this.tl.progress() < 1) this.tl.timeScale(5); }
  /* -------- showcase -------- */
  applyShowcase() {
    const g = this.heli.group, st = this.heli.state;
    this.mode = 'showcase'; this.hover.amount = 0;
    g.position.set(0, 0, 0); g.rotation.set(0, .6, 0); g.scale.setScalar(1);
    st.rpm = .14; st.blur = 0; st.lightsOn = true; st.landingOn = false; st.vib = 0;
    this.shadow.material.opacity = .5; this.shadow.position.y = -1.62;
    if (this.mobile) { this.camTarget.pos.set(13, 4.5, 13); this.camTarget.look.set(-.6, .3, 0); } else { this.camTarget.pos.set(12.5, 4.2, 12.5); this.camTarget.look.set(0, .3, 0); }
    this.camera.position.copy(this.camTarget.pos); this.lookAt.copy(this.camTarget.look);
  }
  setShowcase(p) { this.showcase.p = clamp(p, 0, 1); }
  dragBy(dx) { this.showcase.dragV += dx * .0025; }
  dispose() { this.stop(); this.ro.disconnect(); this.io.disconnect(); document.removeEventListener('visibilitychange', this.onVis); this.renderer.dispose(); }
}

/* ---------------- capability check + bootstrap ---------------- */
export function webglOK() {
  try { const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return false; const dbg = gl.getExtension('WEBGL_debug_renderer_info'); const r = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : ''; return !/SwiftShader|llvmpipe/i.test(r) || !!window.__hh3dForce; } catch (e) { return false; }
}
window.HH3D = { THREE, HeliStage, buildHelicopter, webglOK };
const fontsReady = (document.fonts && document.fonts.load) ? Promise.race([document.fonts.load('italic 900 92px Unbounded').then(() => document.fonts.load('700 28px Manrope')), new Promise((r) => setTimeout(r, 900))]) : Promise.resolve();
fontsReady.then(() => { if (window.__hh3dResolve) window.__hh3dResolve(window.HH3D); });
