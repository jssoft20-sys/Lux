/* =========================================================
   HeliHop 3D v3 — shared engine (Three.js r180)
   One renderer, many views (live / static snapshots), Airbus H125
   model matching the real EX-88010 livery, cockpit start-up intro,
   procedural WebAudio (turbine, rotor, avionics). ES module → window.HH3D
   ========================================================= */
import * as THREE from './vendor/three.module.min.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';

const G = () => window.gsap;
const isMobileDevice = () => innerWidth < 1024 || /Mobi|Android/i.test(navigator.userAgent);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const PI = Math.PI;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

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
  g.addColorStop(0, 'rgba(190,196,204,0)'); g.addColorStop(.1, 'rgba(190,196,204,.06)'); g.addColorStop(.5, 'rgba(200,206,212,.42)'); g.addColorStop(.9, 'rgba(210,214,220,.5)'); g.addColorStop(1, 'rgba(210,214,220,0)');
  x.fillStyle = g; x.fillRect(0, 0, 512, 512);
  // faint blade streaks
  x.translate(256, 256); x.strokeStyle = 'rgba(255,255,255,.08)'; x.lineWidth = 2;
  for (let i = 0; i < 36; i++) { x.beginPath(); x.moveTo(30, 0); x.lineTo(250, 0); x.stroke(); x.rotate(PI / 18); }
  return tex(c, false);
}
function shadowTexture() {
  const c = cnv(256, 256), x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,.8)'); g.addColorStop(.4, 'rgba(0,0,0,.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256); return tex(c, false);
}
function padTexture() {
  const S = 1024, c = cnv(S, S), x = c.getContext('2d');
  x.fillStyle = '#14171b'; x.fillRect(0, 0, S, S);
  const img = x.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() * 16) | 0; d[i] += n; d[i + 1] += n; d[i + 2] += n + 2; }
  x.putImageData(img, 0, 0);
  x.translate(S / 2, S / 2);
  x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 16; x.beginPath(); x.arc(0, 0, S * .44, 0, PI * 2); x.stroke();
  x.setLineDash([26, 22]); x.lineWidth = 4; x.strokeStyle = 'rgba(255,255,255,.3)'; x.beginPath(); x.arc(0, 0, S * .30, 0, PI * 2); x.stroke(); x.setLineDash([]);
  x.fillStyle = 'rgba(255,255,255,.88)'; x.font = `900 ${S * .42}px Unbounded, Manrope, Arial, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('H', 0, S * .02);
  for (let i = 0; i < 36; i++) { x.save(); x.rotate((i / 36) * PI * 2); x.fillStyle = 'rgba(255,255,255,.45)'; x.fillRect(-2, -S * .485, 4, 14); x.restore(); }
  return tex(c);
}
function roundRect(ctx, x0, y0, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x0 + r, y0); ctx.lineTo(x0 + w - r, y0); ctx.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  ctx.lineTo(x0 + w, y0 + h - r); ctx.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  ctx.lineTo(x0 + r, y0 + h); ctx.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  ctx.lineTo(x0, y0 + r); ctx.quadraticCurveTo(x0, y0, x0 + r, y0); ctx.closePath();
}
/** Kyrgyz flag: red field, yellow sun with rays and tunduk */
function drawFlag(x, cx, cy, w) {
  const h = w * .6;
  x.save(); x.translate(cx, cy);
  x.fillStyle = '#e8112d'; x.beginPath(); roundRect(x, -w / 2, -h / 2, w, h, w * .06); x.fill();
  x.fillStyle = '#ffd200';
  for (let i = 0; i < 40; i++) { x.save(); x.rotate((i / 40) * PI * 2); x.fillRect(-w * .012, -h * .42, w * .024, h * .16); x.restore(); }
  x.beginPath(); x.arc(0, 0, h * .3, 0, PI * 2); x.fill();
  x.strokeStyle = '#e8112d'; x.lineWidth = Math.max(1, w * .02);
  x.beginPath(); x.arc(0, 0, h * .2, 0, PI * 2); x.stroke();
  for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(-h * .2, -h * .12 + i * h * .12); x.quadraticCurveTo(0, -h * .2 + i * h * .12, h * .2, -h * .12 + i * h * .12); x.stroke(); }
  x.restore();
}
/** Fuselage livery in UV space: x = along body (tail → nose), y = around (0 port, .25 belly, .5 starboard, .75 roof, 1 port) */
const BODY_X0 = -7.25, BODY_LEN = 10.11;
function bodyTextures() {
  const W = 2048, H = 1024;
  const c = cnv(W, H), x = c.getContext('2d');
  const rC = cnv(W, H), rx = rC.getContext('2d');
  const mC = cnv(W, H), mx = mC.getContext('2d');
  const X = (m) => (m - BODY_X0) / BODY_LEN * W, Y = (u) => u * H;
  x.fillStyle = '#f5f7f9'; x.fillRect(0, 0, W, H);
  rx.fillStyle = 'rgb(88,88,88)'; rx.fillRect(0, 0, W, H);
  mx.fillStyle = 'rgb(20,20,20)'; mx.fillRect(0, 0, W, H);
  // subtle panel shading on the belly
  const belly = x.createLinearGradient(0, Y(.14), 0, Y(.36)); belly.addColorStop(0, 'rgba(0,0,0,0)'); belly.addColorStop(.5, 'rgba(0,0,0,.08)'); belly.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = belly; x.fillRect(X(-7.3), Y(.14), X(2.9) - X(-7.3), Y(.36) - Y(.14));
  const glass = (x0, y0, w, h, r) => {
    [[x, '#0a1117'], [rx, 'rgb(14,14,14)'], [mx, 'rgb(140,140,140)']].forEach(([ctx, col]) => { ctx.fillStyle = col; ctx.beginPath(); roundRect(ctx, x0, y0, w, h, r); ctx.fill(); });
    // reflection gradient inside the pane
    const gr = x.createLinearGradient(x0, y0, x0 + w * .6, y0 + h); gr.addColorStop(0, 'rgba(120,160,190,.18)'); gr.addColorStop(.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(40,60,80,.25)');
    x.fillStyle = gr; x.beginPath(); roundRect(x, x0, y0, w, h, r); x.fill();
    // black rubber frame
    x.strokeStyle = '#121518'; x.lineWidth = 11; x.beginPath(); roundRect(x, x0, y0, w, h, r); x.stroke();
    rx.strokeStyle = 'rgb(160,160,160)'; rx.lineWidth = 11; rx.beginPath(); roundRect(rx, x0, y0, w, h, r); rx.stroke();
  };
  // windscreen: two panes (starboard / port) split by the roof centre pillar
  glass(X(.36), Y(.505), X(2.8) - X(.36), Y(.735) - Y(.505), 120);
  glass(X(.36), Y(.765), X(2.8) - X(.36), Y(.995) - Y(.765), 120);
  // chin (lower nose) windows
  glass(X(1.7), Y(.035), X(2.74) - X(1.7), Y(.215) - Y(.035), 60);
  glass(X(1.7), Y(.285), X(2.74) - X(1.7), Y(.465) - Y(.285), 60);
  // front doors + rear cabin windows (both sides)
  const doors = (yA, yB) => {
    glass(X(-.95), yA, X(.3) - X(-.95), yB - yA, 40);
    glass(X(-2.15), yA, X(-1.05) - X(-2.15), yB - yA, 36);
  };
  doors(Y(.80), Y(.975)); doors(Y(.525), Y(.70));
  // door seams and panel lines
  x.strokeStyle = 'rgba(20,24,30,.55)'; x.lineWidth = 3;
  [.34, -1.0, -2.22].forEach((m) => {
    x.beginPath(); x.moveTo(X(m), Y(.27)); x.lineTo(X(m), Y(.73)); x.stroke();
    x.beginPath(); x.moveTo(X(m), Y(.77)); x.lineTo(X(m), Y(1)); x.stroke();
    x.beginPath(); x.moveTo(X(m), Y(0)); x.lineTo(X(m), Y(.23)); x.stroke();
  });
  x.strokeStyle = 'rgba(20,24,30,.2)'; x.lineWidth = 2;
  [-6.4, -5.2, -3.0].forEach((m) => { x.beginPath(); x.moveTo(X(m), 0); x.lineTo(X(m), H); x.stroke(); });
  // rivet rows on the boom
  x.fillStyle = 'rgba(20,24,30,.16)';
  for (let m = -6.9; m < -2.4; m += .12) { [.06, .19, .31, .44, .56, .69, .81, .94].forEach((u) => x.fillRect(X(m), Y(u), 3, 3)); }
  // registration + red band with the flag (both sides)
  const reg = (cy, flip) => {
    x.save(); x.translate(X(-4.05), cy); if (flip) x.scale(-1, -1);
    x.fillStyle = '#e8112d'; x.beginPath(); roundRect(x, -190, -24, 62, 48, 6); x.fill();
    drawFlag(x, -159, 0, 44);
    x.fillStyle = '#101418'; x.textAlign = 'left'; x.textBaseline = 'middle';
    x.font = '800 60px Manrope, Arial, sans-serif'; x.fillText('EX-88010', -118, 1);
    x.restore();
  };
  reg(Y(.925), false); reg(Y(.575), true);
  // small "helihop.travel" on the doors
  const brand = (cy, flip) => { x.save(); x.translate(X(-1.55), cy); if (flip) x.scale(-1, -1); x.fillStyle = 'rgba(16,20,24,.55)'; x.font = '700 22px Manrope, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('helihop.travel', 0, 0); x.restore(); };
  brand(Y(.755), false); brand(Y(.745), true);
  // no-step / warning markings
  x.fillStyle = '#e8112d'; x.fillRect(X(-2.3), Y(.245), X(-.9) - X(-2.3), 4); x.fillRect(X(-2.3), Y(.255), X(-.9) - X(-2.3), 4);
  const T = (canvas, srgb) => { const t = tex(canvas, srgb); t.flipY = false; t.anisotropy = 8; return t; };
  return { map: T(c, true), roughnessMap: T(rC, false), metalnessMap: T(mC, false) };
}
function decalTexture(text, w = 512, h = 128, font = '800 84px Manrope, Arial, sans-serif', color = '#1a1e24') {
  const c = cnv(w, h), x = c.getContext('2d');
  x.fillStyle = color; x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, w / 2, h / 2 + 4);
  const t = tex(c, true); t.anisotropy = 8; return t;
}

/* ---------------- geometry helpers ---------------- */
function tube(points, r = .05, segs = 32, closed = false) { return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => V3(...p)), closed, 'catmullrom', .2), segs, r, 10, closed); }

/* ---------------- materials ---------------- */
function makeMaterials() {
  const t = bodyTextures();
  return {
    paint: new THREE.MeshPhysicalMaterial({ color: 0xf5f7f9, metalness: .08, roughness: .32, clearcoat: 1, clearcoatRoughness: .12, envMapIntensity: 1.2 }),
    body: new THREE.MeshPhysicalMaterial({ map: t.map, roughnessMap: t.roughnessMap, metalnessMap: t.metalnessMap, roughness: 1, metalness: 1, clearcoat: 1, clearcoatRoughness: .1, envMapIntensity: 1.25 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1b1f24, metalness: .5, roughness: .55, envMapIntensity: .9 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0c0e11, metalness: .3, roughness: .8 }),
    skid: new THREE.MeshStandardMaterial({ color: 0x2b3238, metalness: .55, roughness: .5, envMapIntensity: 1 }),
    hub: new THREE.MeshStandardMaterial({ color: 0xc3c8ce, metalness: .75, roughness: .38, envMapIntensity: 1.3 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd2d7dc, metalness: 1, roughness: .22, envMapIntensity: 1.5 }),
    copper: new THREE.MeshStandardMaterial({ color: 0x8a5a3c, metalness: .9, roughness: .38, envMapIntensity: 1.6 }),
    blade: new THREE.MeshStandardMaterial({ color: 0xa4aab0, metalness: .4, roughness: .55, transparent: true, opacity: 1 }),
    bladeEdge: new THREE.MeshStandardMaterial({ color: 0x2b3036, metalness: .6, roughness: .45, transparent: true, opacity: 1 }),
    pad: new THREE.MeshStandardMaterial({ map: padTexture(), roughness: .92, metalness: .05, transparent: true }),
    decal: (txt) => new THREE.MeshBasicMaterial({ map: decalTexture(txt), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  };
}

/* ---------------- helicopter (Airbus H125 / EX-88010) ---------------- */
export function buildHelicopter(m) {
  const g = new THREE.Group();
  const add = (geo, mat, pos, rot, scale, parent = g) => { const mesh = new THREE.Mesh(geo, mat); if (pos) mesh.position.set(...pos); if (rot) mesh.rotation.set(...rot); if (scale) mesh.scale.set(...scale); parent.add(mesh); return mesh; };
  // fuselage: smooth profile revolved along X, then sculpted (flat belly, wide cabin)
  const ctrl = [[-7.25, 0], [-7.2, .1], [-6.9, .16], [-6.2, .19], [-5.3, .23], [-4.4, .28], [-3.4, .33], [-2.6, .42], [-2.05, .58], [-1.65, .84], [-1.15, 1.08], [-.55, 1.22], [.2, 1.27], [.9, 1.23], [1.6, 1.11], [2.15, .9], [2.55, .6], [2.8, .26], [2.86, 0]];
  const curve = new THREE.CatmullRomCurve3(ctrl.map(([px, r]) => V3(px, r, 0)), false, 'centripetal');
  const samples = curve.getPoints(900);
  const N = 150, pts = [];
  for (let i = 0; i < N; i++) {
    const px = BODY_X0 + (i / (N - 1)) * BODY_LEN;
    let best = samples[0]; for (const sp of samples) { if (Math.abs(sp.x - px) < Math.abs(best.x - px)) best = sp; }
    const r = (i === 0 || i === N - 1) ? 0 : Math.max(.02, best.y);
    pts.push(new THREE.Vector2(r, px));
  }
  const lathe = new THREE.LatheGeometry(pts, 112);
  const uv = lathe.attributes.uv;
  for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v, u); }
  lathe.rotateZ(-PI / 2);
  const pos = lathe.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (x > -2.0) {
      const k = clamp((x + 2.0) / .8, 0, 1);
      if (y < 0) y *= lerp(1, .78, k); else y *= lerp(1, 1.08, k);
      z *= lerp(1, 1.0 - .12 * Math.max(0, y) / 1.3, k);
    }
    if (x < -2.0) y += (-2.0 - x) * .075;
    pos.setXYZ(i, x, y, z);
  }
  lathe.computeVertexNormals();
  const body = add(lathe, m.body);
  // engine deck + cowling
  const cowl = new THREE.CapsuleGeometry(.5, 1.5, 8, 24); cowl.rotateZ(PI / 2);
  const cowlMesh = add(cowl, m.paint, [-.8, 1.16, 0], null, [1, .74, 1.06]);
  add(new THREE.BoxGeometry(1.7, .28, 1.05, 2, 2, 2), m.paint, [-.75, .98, 0]);
  add(new THREE.BoxGeometry(.5, .16, .72, 2, 2, 2), m.dark, [.15, 1.3, 0]); // intake
  add(new THREE.CylinderGeometry(.15, .17, .62, 18), m.copper, [-2.05, 1.2, .34], [0, 0, PI / 2 + .3]); // exhaust
  add(new THREE.TorusGeometry(.155, .02, 8, 18), m.dark, [-2.32, 1.14, .42], [0, 0, PI / 2 + .3]);
  // "AIRBUS" decals on the cowling
  ['+', '-'].forEach((s) => { const d = add(new THREE.PlaneGeometry(.9, .22), m.decal('AIRBUS'), [-1.05, 1.22, s === '+' ? .545 : -.545], [0, s === '+' ? 0 : PI, 0]); d.renderOrder = 2; });
  // mast + Starflex head
  add(new THREE.CylinderGeometry(.09, .1, .66, 16), m.dark, [-.15, 1.68, 0]);
  add(new THREE.CylinderGeometry(.28, .32, .14, 24), m.dark, [-.15, 1.96, 0]);
  add(new THREE.CylinderGeometry(.1, .13, .2, 12), m.hub, [-.15, 2.16, 0]);
  const rotor = new THREE.Group(); rotor.position.set(-.15, 2.06, 0); g.add(rotor);
  for (let k = 0; k < 3; k++) {
    const b = new THREE.Group(); b.rotation.y = (k / 3) * PI * 2; rotor.add(b);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(5.1, .05, .36, 8, 1, 1), m.blade); blade.position.x = 2.95; blade.rotation.x = .09; blade.rotation.z = -.03; b.add(blade);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(5.1, .052, .07), m.bladeEdge); edge.position.set(2.95, 0, .16); edge.rotation.x = .09; edge.rotation.z = -.03; b.add(edge);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(.5, .054, .37), m.bladeEdge); tip.position.x = 5.35; tip.rotation.x = .09; tip.rotation.z = -.03; b.add(tip);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(.7, .07, .22), m.hub); arm.position.x = .42; b.add(arm);
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(.5, .12, .2), m.dark); sleeve.position.x = .68; b.add(sleeve);
  }
  const blur = new THREE.Mesh(new THREE.CircleGeometry(5.7, 72), new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, color: 0xd6dbe0 }));
  blur.rotation.x = -PI / 2; blur.position.set(-.15, 2.08, 0); g.add(blur);
  // tail: upper fin, ventral fin, stabilizer with end plates
  const finShape = new THREE.Shape(); finShape.moveTo(-6.4, .3); finShape.lineTo(-6.15, 1.7); finShape.lineTo(-6.68, 1.82); finShape.lineTo(-7.18, .32); finShape.closePath();
  add(new THREE.ExtrudeGeometry(finShape, { depth: .1, bevelEnabled: true, bevelThickness: .02, bevelSize: .02, bevelSegments: 2 }), m.paint, [0, 0, -.05]);
  const vfin = new THREE.Shape(); vfin.moveTo(-6.5, -.05); vfin.lineTo(-6.8, -1.02); vfin.lineTo(-7.14, -1.02); vfin.lineTo(-7.22, -.05); vfin.closePath();
  add(new THREE.ExtrudeGeometry(vfin, { depth: .08, bevelEnabled: false }), m.paint, [0, 0, -.04]);
  add(new THREE.BoxGeometry(.64, .06, 2.4), m.paint, [-5.6, .5, 0]);
  add(new THREE.BoxGeometry(.66, .6, .05), m.paint, [-5.6, .5, 1.2]);
  add(new THREE.BoxGeometry(.66, .6, .05), m.paint, [-5.6, .5, -1.2]);
  // tail rotor (2 blades, port side)
  const tail = new THREE.Group(); tail.position.set(-6.95, 1.05, -.36); g.add(tail);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, .16, 12), m.dark); hub.rotation.x = PI / 2; tail.add(hub);
  const tb = new THREE.Mesh(new THREE.BoxGeometry(.17, 1.95, .03), m.blade); tail.add(tb);
  const tbe = new THREE.Mesh(new THREE.BoxGeometry(.05, 1.95, .032), m.bladeEdge); tbe.position.x = .08; tail.add(tbe);
  const tblur = new THREE.Mesh(new THREE.CircleGeometry(1.0, 32), new THREE.MeshBasicMaterial({ map: blur.material.map, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, color: 0xd6dbe0 }));
  tblur.position.set(-6.95, 1.05, -.4); g.add(tblur);
  add(new THREE.CylinderGeometry(.04, .05, .5, 8), m.dark, [-6.95, 1.05, -.12], [PI / 2, 0, 0]); // gearbox shaft
  // skids (dark grey) with curled fronts, cross tubes and steps
  for (const z of [-1.0, 1.0]) add(tube([[-2.35, -1.5, z], [-1.4, -1.55, z], [.6, -1.55, z], [2.0, -1.55, z], [2.6, -1.45, z], [3.0, -1.15, z], [3.1, -.95, z]], .055, 40), m.skid);
  for (const xx of [-1.1, 1.35]) add(tube([[xx, -1.55, -1.0], [xx, -1.2, -.8], [xx, -.95, 0], [xx, -1.2, .8], [xx, -1.55, 1.0]], .05, 28), m.skid);
  for (const z of [-1.0, 1.0]) { add(new THREE.BoxGeometry(1.0, .06, .22), m.skid, [.15, -1.3, z * .92]); add(new THREE.BoxGeometry(.06, .3, .06), m.skid, [-.3, -1.15, z * .9]); add(new THREE.BoxGeometry(.06, .3, .06), m.skid, [.6, -1.15, z * .9]); }
  // wire strike protection + pitot + antennas
  add(new THREE.BoxGeometry(.5, .28, .04), m.dark, [1.95, 1.1, 0], [0, 0, .5]);
  add(new THREE.BoxGeometry(.4, .24, .04), m.dark, [2.3, -.86, 0], [0, 0, -.5]);
  add(new THREE.CylinderGeometry(.012, .016, .5, 6), m.dark, [2.75, .35, .3], [0, 0, PI / 2]);
  add(new THREE.CylinderGeometry(.012, .016, .4, 6), m.black, [-3.4, .66, 0]);
  add(new THREE.CylinderGeometry(.014, .014, .3, 6), m.black, [-2.8, -.62, 0]);
  add(new THREE.BoxGeometry(.3, .12, .02), m.black, [-4.6, -.42, 0]);
  // mirrors on the nose
  for (const z of [-.95, .95]) { add(new THREE.CylinderGeometry(.012, .012, .5, 6), m.dark, [1.9, .1, z], [PI / 2, 0, 0]); add(new THREE.BoxGeometry(.05, .16, .12), m.dark, [1.9, .1, z * 1.28]); }
  // lights
  const glowMap = glowTexture();
  const light = (color, p, size = .9) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(.055, 12, 12), new THREE.MeshBasicMaterial({ color })); s.position.set(...p); g.add(s);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); sp.scale.setScalar(size); sp.position.set(...p); g.add(sp);
    return { mesh: s, sprite: sp, base: new THREE.Color(color) };
  };
  const lights = {
    navL: light(0xff2a2a, [.35, .05, 1.2]), navR: light(0x2aff6a, [.35, .05, -1.2]),
    beacon: light(0xff3030, [-1.2, 1.62, 0], 1.3), strobe: light(0xffffff, [-6.6, 1.88, 0], 1.1), belly: light(0xff3030, [-1.6, -1.0, 0], 1.0),
    landing: light(0xfff4d6, [2.4, -.7, 0], 2.2),
  };
  const setLight = (l, on) => { l.sprite.material.opacity = on ? 1 : 0; l.mesh.material.color.copy(l.base).multiplyScalar(on ? 1 : .3); };
  const api = {
    group: g, rotor, tail, blur, tblur, lights, body, cowl: cowlMesh,
    setBlur(v) { blur.material.opacity = v * .95; tblur.material.opacity = v * .8; m.blade.opacity = 1 - v * .72; m.bladeEdge.opacity = 1 - v * .72; },
    setLights(st, t) {
      const beaconOn = (t % 1.1) < .09 || ((t % 1.1) > .2 && (t % 1.1) < .27);
      const strobeOn = (t % 1.5) < .05 || ((t % 1.5) > .14 && (t % 1.5) < .19);
      setLight(lights.beacon, st.lightsOn && beaconOn); setLight(lights.belly, st.lightsOn && beaconOn); setLight(lights.strobe, st.lightsOn && strobeOn);
      setLight(lights.navL, st.lightsOn); setLight(lights.navR, st.lightsOn); setLight(lights.landing, st.landingOn);
    },
  };
  return api;
}

/* ---------------- poses / presets ---------------- */
const R_FIT = 6.4; // bounding radius of the aircraft
function fitDistance(v, fov, k = 1) { const a = v.camera.aspect; const f = (fov * PI / 180) / 2; const eff = a < 1 ? Math.atan(Math.tan(f) * a) : f; return (R_FIT * k) / Math.sin(eff); }
function heroPose(v) {
  const m = v.engine.mobile, o = v.params.poseOffset || [0, 0, 0];
  return { pos: V3((m ? 1.9 : 4.1) + o[0], (m ? 4.4 : 1.2) + o[1], (m ? -1 : -.5) + o[2]), yaw: PI + .62, scale: m ? .62 : .96, cam: V3(0, 1.6, 17), look: V3(0, .4, 0) };
}
const PRESETS = {
  manual: { update() {} },
  hero: {
    init(v) {
      const P = heroPose(v);
      v.pos.copy(P.pos); v.rot.set(0, P.yaw, 0); v.scale = P.scale; v.cam.copy(P.cam); v.look.copy(P.look); v.camT.copy(P.cam); v.lookT.copy(P.look);
      v.hover.base.copy(P.pos); v.hover.yaw = P.yaw; v.hover.amount = 1;
      Object.assign(v.st, { rpm: 1, blur: .58, lightsOn: true, landingOn: false, vib: 0, ground: 0, pad: 0, dust: 0, shadow: 0 });
    },
    update(v, t) {
      v.pointer.x = lerp(v.pointer.x, v.pointer.tx, .06); v.pointer.y = lerp(v.pointer.y, v.pointer.ty, .06);
      if (v.hover.amount > 0) {
        const a = v.hover.amount, sc = smooth(v.scroll);
        const bob = Math.sin(t * 1.15) * .12 + Math.sin(t * 2.3) * .03;
        const px = v.pointer.x, py = v.pointer.y;
        const target = v.hover.base.clone().add(V3(-3.5 * sc, 7.5 * sc, -14 * sc));
        target.y += bob * a; target.x += px * .6 * a; target.y += -py * .35 * a;
        v.pos.lerp(target, a >= 1 ? .12 : a);
        const yaw = v.hover.yaw + px * .22 * a, roll = -px * .3 * a + Math.sin(t * .8) * .025 * a, pitch = py * .12 * a - .3 * sc;
        v.rot.y = lerp(v.rot.y, yaw, .08); v.rot.x = lerp(v.rot.x, roll, .08); v.rot.z = lerp(v.rot.z, pitch, .08);
      }
      v.cam.lerp(v.camT, .08); v.look.lerp(v.lookT, .08);
    },
  },
  showcase: {
    init(v) {
      v.pos.set(0, 0, 0); v.rot.set(0, .6, 0); v.scale = 1;
      Object.assign(v.st, { rpm: .14, blur: 0, lightsOn: true, landingOn: false, vib: 0, ground: 1, shadow: .5, pad: 0, dust: 0 });
      const kf = v.engine.mobile ? [13, 4.5, 13, -.6, .3, 0] : [12.5, 4.2, 12.5, 0, .3, 0];
      v.cam.set(kf[0], kf[1], kf[2]); v.look.set(kf[3], kf[4], kf[5]); v.camT.copy(v.cam); v.lookT.copy(v.look);
    },
    update(v, t) {
      v.drag += v.dragV; v.dragV *= .93;
      v.rot.y = lerp(v.rot.y, .6 + v.progress * PI * 1.35 + v.drag, .1);
      v.pos.y = Math.sin(t * .9) * .06;
      const kf = v.engine.mobile ? [[13, 4.5, 13, -.6, .3, 0], [6.6, 1.2, 8.8, 1.1, .5, 0], [1.5, 8.8, 5.8, -.3, 1.8, 0], [-9.5, -1.1, 10.5, -2.8, -.5, 0]] : [[12.5, 4.2, 12.5, 0, .3, 0], [6.2, 1.1, 8.4, 1.6, .5, 0], [1.5, 8.5, 5.5, -.3, 1.9, 0], [-9.5, -1.2, 10.5, -3.2, -.5, 0]];
      const p = v.progress * 3, i = Math.min(2, Math.floor(p)), f = smooth(clamp(p - i, 0, 1)), A = kf[i], B = kf[i + 1];
      v.camT.set(lerp(A[0], B[0], f), lerp(A[1], B[1], f), lerp(A[2], B[2], f));
      v.lookT.set(lerp(A[3], B[3], f), lerp(A[4], B[4], f), lerp(A[5], B[5], f));
      v.cam.lerp(v.camT, .08); v.look.lerp(v.lookT, .08);
    },
  },
  /* small live card: slow turntable, idle rotor */
  card: {
    init(v) {
      v.pos.set(0, 0, 0); v.scale = 1; v.rot.set(0, v.params.yaw != null ? v.params.yaw : .55, 0);
      Object.assign(v.st, { rpm: v.params.rpm != null ? v.params.rpm : .12, blur: 0, lightsOn: v.params.lights !== false, landingOn: false, vib: 0, ground: v.params.ground != null ? v.params.ground : 1, shadow: .45, pad: 0, dust: 0 });
      v.baseYaw = v.rot.y;
    },
    update(v, t) {
      v.drag += v.dragV; v.dragV *= .92;
      const spin = v.params.spin != null ? v.params.spin : .18;
      v.rot.y = v.baseYaw + Math.sin(t * .32) * .45 + t * spin * 0 + v.drag + (v.params.turn ? t * .35 : 0);
      v.rot.x = Math.sin(t * .5) * .015; v.pos.y = (v.params.float ? Math.sin(t * .9) * .08 : 0);
      const fov = v.params.fov || 30; v.camera.fov = fov; v.camera.updateProjectionMatrix();
      const d = fitDistance(v, fov, v.params.fit || 1.02);
      const el = v.params.elev != null ? v.params.elev : .32;
      const dir = V3(Math.cos(el) * .72, Math.sin(el), Math.cos(el) * .69).normalize();
      v.cam.copy(dir.multiplyScalar(d)); v.cam.y += (v.params.camY || 0); v.look.set(0, .2 + (v.params.lookY || 0), 0);
    },
  },
  /* banked flight, for the CTA fly-by and story scenes */
  fly: {
    init(v) {
      v.pos.set(0, 0, 0); v.scale = 1; v.rot.set(0, v.params.yaw != null ? v.params.yaw : PI + .9, 0);
      Object.assign(v.st, { rpm: 1, blur: .6, lightsOn: true, landingOn: !!v.params.landingLight, vib: 0, ground: 0, shadow: 0, pad: 0, dust: 0 });
    },
    update(v, t) {
      const yaw = v.params.yaw != null ? v.params.yaw : PI + .9;
      v.rot.set((v.params.roll != null ? v.params.roll : -.22) + Math.sin(t * .7) * .04, yaw + Math.sin(t * .4) * .06, (v.params.pitch != null ? v.params.pitch : -.14) + Math.sin(t * .9) * .03);
      v.pos.y = Math.sin(t * 1.1) * .14 + Math.sin(t * 2.3) * .04;
      const fov = v.params.fov || 30; v.camera.fov = fov; v.camera.updateProjectionMatrix();
      const d = fitDistance(v, fov, v.params.fit || 1.0);
      const el = v.params.elev != null ? v.params.elev : -.12;
      const dir = V3(Math.cos(el) * .55, Math.sin(el), Math.cos(el) * .84).normalize();
      v.cam.copy(dir.multiplyScalar(d)); v.look.set(0, .3, 0);
    },
  },
  /* on the ground: engines off / spooling (story scenes) */
  ground: {
    init(v) {
      v.pos.set(0, 0, 0); v.scale = 1; v.rot.set(0, v.params.yaw != null ? v.params.yaw : .7, 0);
      Object.assign(v.st, { rpm: v.params.rpm || 0, blur: 0, lightsOn: !!v.params.lights, landingOn: false, vib: 0, ground: 1, shadow: .8, pad: v.params.pad != null ? v.params.pad : 1, dust: 0 });
    },
    update(v, t) {
      v.drag += v.dragV; v.dragV *= .92;
      v.rot.y = (v.params.yaw != null ? v.params.yaw : .7) + v.drag + (v.params.orbit ? Math.sin(t * .25) * .3 : 0);
      const fov = v.params.fov || 30; v.camera.fov = fov; v.camera.updateProjectionMatrix();
      const d = fitDistance(v, fov, v.params.fit || 1.05);
      const el = v.params.elev != null ? v.params.elev : .14;
      const dir = V3(Math.cos(el) * .74, Math.sin(el), Math.cos(el) * .67).normalize();
      v.cam.copy(dir.multiplyScalar(d)); v.look.set(0, .1, 0);
      v.st.blur = clamp((v.st.rpm - .45) / .5, 0, 1) * .6;
      v.st.vib = v.st.rpm > .05 && v.st.rpm < .95 ? 1 : 0;
      v.st.dust = v.st.rpm > .7 ? (v.st.rpm - .7) / .3 * .6 : 0;
    },
  },
  /* static snapshots */
  top: {
    init(v) { v.pos.set(0, 0, 0); v.scale = 1; v.rot.set(0, 0, 0); Object.assign(v.st, { rpm: .5, blur: .35, lightsOn: false, landingOn: false, vib: 0, ground: 0, pad: 0, dust: 0, shadow: 0 }); v.camera.up.set(1, 0, 0); },
    update(v) { v.camera.fov = 14; v.camera.updateProjectionMatrix(); const d = fitDistance(v, 14, 1.0); v.cam.set(0, d, .001); v.look.set(.15, 0, 0); },
  },
  side: {
    init(v) { v.pos.set(0, 0, 0); v.scale = 1; v.rot.set(0, 0, 0); Object.assign(v.st, { rpm: 1, blur: .55, lightsOn: true, landingOn: false, vib: 0, ground: 0, pad: 0, dust: 0, shadow: 0 }); },
    update(v) { v.camera.fov = 16; v.camera.updateProjectionMatrix(); const d = fitDistance(v, 16, 1.0); v.cam.set(0, .6, d); v.look.set(0, .2, 0); },
  },
  iso: {
    init(v) { v.pos.set(0, 0, 0); v.scale = 1; v.rot.set(0, v.params.yaw != null ? v.params.yaw : .5, 0); Object.assign(v.st, { rpm: .3, blur: .1, lightsOn: true, landingOn: false, vib: 0, ground: 0, pad: 0, dust: 0, shadow: 0 }); },
    update(v) { const fov = v.params.fov || 26; v.camera.fov = fov; v.camera.updateProjectionMatrix(); const d = fitDistance(v, fov, v.params.fit || 1.0); const el = v.params.elev != null ? v.params.elev : .35; const dir = V3(Math.cos(el) * .7, Math.sin(el), Math.cos(el) * .71).normalize(); v.cam.copy(dir.multiplyScalar(d)); v.look.set(0, .1, 0); },
  },
};

/* ---------------- view ---------------- */
class View {
  constructor(engine, el, o = {}) {
    this.engine = engine; this.el = el; this.params = o;
    this.kind = o.kind || 'live';
    this.primaryCapable = !!o.primary;
    this.holdsMaster = false;
    this.canvas = null; this.ctx = null;
    if (!this.primaryCapable) {
      this.canvas = document.createElement('canvas'); this.canvas.className = 'v3d';
      this.ctx = this.canvas.getContext('2d');
      if (el) el.appendChild(this.canvas);
    }
    this.camera = new THREE.PerspectiveCamera(30, 1, .1, 400);
    this.st = { rpm: 0, blur: 0, lightsOn: false, landingOn: false, vib: 0, ground: 0, shadow: 0, pad: 0, dust: 0, rotorA: Math.random() * 6, tailA: 0 };
    this.pos = V3(); this.rot = new THREE.Euler(); this.scale = 1;
    this.cam = V3(0, 1.6, 17); this.look = V3(0, .4, 0); this.camT = this.cam.clone(); this.lookT = this.look.clone();
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 }; this.scroll = 0; this.progress = 0; this.drag = 0; this.dragV = 0;
    this.hover = { amount: 0, base: V3(), yaw: 0 };
    this.visible = !el; this.dirty = true; this.needsSize = true; this.w = 2; this.h = 2; this.cw = 2; this.ch = 2; this.t = Math.random() * 10;
    this.fixed = o.size ? { w: o.size, h: o.size2 || o.size } : null;
    if (el) {
      this.io = new IntersectionObserver((en) => { this.visible = en[0].isIntersecting; if (this.visible) this.dirty = true; engine.onVisibility(this); }, { rootMargin: '10% 0px' });
      this.io.observe(el);
      this.ro = new ResizeObserver(() => { this.needsSize = true; this.dirty = true; });
      this.ro.observe(el);
    }
    this.setPreset(o.pose || 'card');
  }
  setPreset(name, params) {
    if (params) Object.assign(this.params, params);
    this.preset = PRESETS[name] || PRESETS.card; this.presetName = name;
    if (this.preset.init) this.preset.init(this);
    this.dirty = true;
  }
  size() {
    const d = this.engine.dprFor(this);
    const w = this.fixed ? this.fixed.w : Math.max(2, this.el.clientWidth), h = this.fixed ? this.fixed.h : Math.max(2, this.el.clientHeight);
    this.cw = w; this.ch = h; this.w = Math.max(2, Math.round(w * (this.fixed ? 1 : d))); this.h = Math.max(2, Math.round(h * (this.fixed ? 1 : d)));
    this.camera.aspect = w / h;
    if (!this.params.fov && (this.presetName === 'hero' || this.presetName === 'manual' || this.presetName === 'showcase')) this.camera.fov = this.camera.aspect < .8 ? 46 : this.camera.aspect < 1.2 ? 38 : 32;
    this.camera.updateProjectionMatrix();
    if (this.canvas) { this.canvas.width = this.w; this.canvas.height = this.h; }
    this.needsSize = false;
  }
  moveTo(el) {
    this.el = el; this.io && this.io.disconnect(); this.ro && this.ro.disconnect();
    this.io = new IntersectionObserver((en) => { this.visible = en[0].isIntersecting; if (this.visible) this.dirty = true; this.engine.onVisibility(this); }, { rootMargin: '10% 0px' }); this.io.observe(el);
    this.ro = new ResizeObserver(() => { this.needsSize = true; this.dirty = true; }); this.ro.observe(el);
    if (this.holdsMaster) el.appendChild(this.engine.master); else if (this.canvas) el.appendChild(this.canvas);
    this.visible = true; this.needsSize = true; this.dirty = true;
  }
  setPointer(x, y) { this.pointer.tx = clamp(x, -1, 1); this.pointer.ty = clamp(y, -1, 1); }
  setScroll(p) { this.scroll = clamp(p, 0, 1); }
  setProgress(p) { this.progress = clamp(p, 0, 1); this.dirty = true; }
  dragBy(dx) { this.dragV += dx * .0025; this.dirty = true; }
  invalidate() { this.dirty = true; }
  remove() { this.io && this.io.disconnect(); this.ro && this.ro.disconnect(); this.engine.views.delete(this); if (this.canvas) this.canvas.remove(); if (this.holdsMaster) this.engine.detachMaster(); }
}

/* ---------------- engine ---------------- */
export class Engine {
  constructor(o = {}) {
    this.mobile = o.mobile != null ? o.mobile : isMobileDevice();
    this.master = document.createElement('canvas'); this.master.className = 'v3d v3d--master';
    const renderer = new THREE.WebGLRenderer({ canvas: this.master, alpha: true, antialias: !this.mobile, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.04;
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;
    const scene = this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
    pmrem.dispose();
    const key = new THREE.DirectionalLight(0xffffff, 2.5); key.position.set(9, 14, 10); scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfe1ff, 1.9); rim.position.set(-12, 7, -9); scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffffff, .55); fill.position.set(-6, 2, 12); scene.add(fill);
    this.mats = makeMaterials();
    this.heli = buildHelicopter(this.mats);
    scene.add(this.heli.group);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 11.5), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, opacity: 0, depthWrite: false }));
    this.shadow.rotation.x = -PI / 2; this.shadow.visible = false; scene.add(this.shadow);
    this.pad = new THREE.Mesh(new THREE.CircleGeometry(6.6, 72), this.mats.pad);
    this.pad.rotation.x = -PI / 2; this.pad.visible = false; scene.add(this.pad);
    this.padLights = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * PI * 2;
      const l = new THREE.Mesh(new THREE.SphereGeometry(.09, 10, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      l.position.set(Math.cos(a) * 6.3, Math.sin(a) * 6.3, .08); this.pad.add(l); this.padLights.push(l);
    }
    const N = this.mobile ? 160 : 320, pts = new Float32Array(N * 3), seeds = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { const a = Math.random() * PI * 2, r = 2.5 + Math.random() * 4; pts[i * 3] = Math.cos(a) * r; pts[i * 3 + 1] = Math.random() * 1.2; pts[i * 3 + 2] = Math.sin(a) * r; seeds[i * 2] = a; seeds[i * 2 + 1] = r; }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.dustSeeds = seeds;
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: .07, map: glowTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xaeb6bf, sizeAttenuation: true }));
    this.dust.visible = false; scene.add(this.dust);
    this.views = new Set(); this.holder = null; this.bufW = 0; this.bufH = 0;
    this.running = false; this.last = performance.now(); this.t = 0;
    this.frame = this.frame.bind(this);
    this.onVis = () => { this.last = performance.now(); };
    document.addEventListener('visibilitychange', this.onVis);
  }
  dprFor(v) {
    const d = Math.min(devicePixelRatio || 1, this.mobile ? 1.5 : 2);
    if (!v.el) return 1;
    const px = v.el.clientWidth * v.el.clientHeight * d * d, cap = this.mobile ? 1.5e6 : 2.6e6;
    return px > cap ? d * Math.sqrt(cap / px) : d;
  }
  addView(el, o = {}) { const v = new View(this, el, o); this.views.add(v); if (v.primaryCapable && !this.holder) this.attachMaster(v); this.start(); return v; }
  attachMaster(v) { if (this.holder === v) return; if (this.holder) this.holder.holdsMaster = false; this.holder = v; v.holdsMaster = true; v.el.appendChild(this.master); v.needsSize = true; v.dirty = true; }
  detachMaster() { if (this.holder) { this.holder.holdsMaster = false; this.holder = null; } this.master.remove(); }
  onVisibility(v) { if (v.primaryCapable && v.visible && this.holder !== v) this.attachMaster(v); }
  start() { if (this.running) return; this.running = true; this.last = performance.now(); requestAnimationFrame(this.frame); }
  stop() { this.running = false; }
  frame(now) {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    let dt = (now - this.last) / 1000; this.last = now;
    if (dt > .1) dt = .1;
    if (document.hidden) return;
    this.t += dt;
    let primary = null, live = 0;
    const maxLive = this.mobile ? 2 : 6;
    for (const v of this.views) {
      if (!v.visible) continue;
      if (v.holdsMaster) { primary = v; continue; }
      if (v.kind === 'static' && !v.dirty && !v.needsSize) continue;
      if (v.kind !== 'static' && live >= maxLive) continue;
      live++;
      this.renderView(v, dt, false);
    }
    if (primary) this.renderView(primary, dt, true);
  }
  ensureBuffer(w, h) { if (w > this.bufW || h > this.bufH) { this.bufW = Math.max(this.bufW, w); this.bufH = Math.max(this.bufH, h); this.renderer.setSize(this.bufW, this.bufH, false); } }
  applyView(v, dt) {
    const h = this.heli, g = h.group, st = v.st;
    g.position.copy(v.pos); g.rotation.copy(v.rot); g.scale.setScalar(v.scale);
    if (st.vib > 0) { const a = st.vib * Math.max(.15, st.rpm) * .012 * v.scale; g.position.x += (Math.random() - .5) * a; g.position.z += (Math.random() - .5) * a; g.rotation.z += (Math.random() - .5) * a * .5; }
    st.rotorA += st.rpm * 34 * dt; st.tailA += st.rpm * 160 * dt;
    h.rotor.rotation.y = st.rotorA; h.tail.rotation.z = st.tailA;
    h.setBlur(st.blur); h.setLights(st, v.t);
    const gy = v.pos.y - 1.6 * v.scale;
    this.shadow.visible = st.shadow > .01; this.shadow.material.opacity = st.shadow; this.shadow.position.set(v.pos.x, gy + .01, v.pos.z); this.shadow.scale.setScalar(v.scale);
    this.pad.visible = st.pad > .01; this.pad.material.opacity = st.pad; this.pad.position.set(v.padX || 0, gy, v.padZ || 0); this.pad.scale.setScalar(v.scale);
    if (this.pad.visible) { this.padLights.forEach((l, i) => { l.visible = st.pad > .05; l.material.color.setScalar(.6 + .4 * Math.sin(v.t * 2.2 + i * .4)); }); }
    this.dust.visible = st.dust > .01; this.dust.material.opacity = st.dust; this.dust.position.set(v.padX || 0, gy, v.padZ || 0); this.dust.scale.setScalar(v.scale);
    if (this.dust.visible) {
      const p = this.dust.geometry.attributes.position, s = this.dustSeeds, n = p.count, t = v.t;
      for (let i = 0; i < n; i++) { const a = s[i * 2] + t * (.35 + (i % 5) * .05), r = s[i * 2 + 1] + Math.sin(t * .7 + i) * .4; p.setX(i, Math.cos(a) * r); p.setZ(i, Math.sin(a) * r); p.setY(i, .05 + ((t * .6 + i * .37) % 1.4)); }
      p.needsUpdate = true;
    }
    v.camera.position.copy(v.cam); v.camera.lookAt(v.look);
  }
  renderView(v, dt, isPrimary) {
    if (v.needsSize) v.size();
    v.t += dt;
    v.preset.update(v, v.t, dt, this);
    this.applyView(v, dt);
    const r = this.renderer;
    if (isPrimary) {
      if (this.bufW !== v.w || this.bufH !== v.h) { this.bufW = v.w; this.bufH = v.h; r.setSize(v.w, v.h, false); }
      r.setScissorTest(false); r.setViewport(0, 0, v.w, v.h);
      r.render(this.scene, v.camera);
    } else {
      if (!this.holder) this.ensureBuffer(v.w, v.h);
      const w = Math.min(v.w, this.bufW), h = Math.min(v.h, this.bufH);
      if (w < 2 || h < 2) return;
      r.setViewport(0, 0, w, h); r.setScissor(0, 0, w, h); r.setScissorTest(true);
      r.render(this.scene, v.camera);
      v.ctx.clearRect(0, 0, v.w, v.h);
      v.ctx.drawImage(this.master, 0, this.bufH - h, w, h, 0, 0, v.w, v.h);
    }
    v.dirty = false;
  }
  /** one-off render of a static pose into a small canvas (used for map / chart markers) */
  snapshot(pose, size = 128, params = {}) {
    const v = new View(this, null, { pose, size, ...params });
    v.size(); this.ensureBuffer(v.w, v.h); this.renderView(v, 0, false);
    const out = v.canvas; v.canvas = null; v.remove();
    return out;
  }
  /* -------- intro: cockpit start → take-off → fly to hero pose (on view v) -------- */
  intro(v, { onReveal, onDone, onStage, short = false } = {}) {
    const gs = G(), st = v.st, P = heroPose(v);
    v.setPreset('manual'); v.scale = P.scale;
    const tl = gs.timeline({ onComplete: () => { onDone && onDone(); } });
    this.tl = tl;
    if (short) {
      Object.assign(st, { rpm: 1, blur: .58, lightsOn: true, ground: 0, shadow: 0, pad: 0, dust: 0 });
      const from = V3(P.pos.x - 14, P.pos.y - 6, P.pos.z + 4);
      v.pos.copy(from); v.rot.set(.25, P.yaw - .5, -.2);
      v.cam.copy(P.cam); v.look.copy(P.look); v.camT.copy(P.cam); v.lookT.copy(P.look);
      tl.to(v.pos, { x: P.pos.x, y: P.pos.y, z: P.pos.z, duration: 1.7, ease: 'power3.out' }, 0)
        .to(v.rot, { x: 0, y: P.yaw, z: 0, duration: 1.9, ease: 'power3.out' }, 0)
        .call(() => onReveal && onReveal(), null, .15)
        .call(() => { v.setPreset('hero'); v.hover.amount = 0; v.pos.copy(P.pos); v.rot.set(0, P.yaw, 0); }, null, 1.7)
        .to(v.hover, { amount: 1, duration: .8 }, 1.75);
      return tl;
    }
    Object.assign(st, { rpm: 0, blur: 0, lightsOn: false, landingOn: false, vib: 0, ground: 1, shadow: .85, pad: 1, dust: 0 });
    v.pos.set(0, 0, 0); v.rot.set(0, 0, 0);
    const camA = V3(7.6, 1.3, 8.6), lookA = V3(.6, 1.1, 0), camB = V3(10.8, 3.4, 12.8), lookB = V3(.4, .8, 0);
    v.cam.copy(camA); v.look.copy(lookA);
    const path = new THREE.CatmullRomCurve3([V3(0, .9, 0), V3(-2.5, 2.6, 3.5), V3(-1.5, 6.2, 1.5), V3(2.5, 5.5, -3), P.pos.clone()]);
    const flight = { u: 0 };
    const stage = (s) => () => { onStage && onStage(s); };
    tl.call(stage('batt'), null, 0)
      .call(() => { st.lightsOn = true; }, null, .35)
      .call(stage('lights'), null, .35)
      .to(v.cam, { x: camB.x, y: camB.y, z: camB.z, duration: 3.6, ease: 'power1.inOut' }, 0)
      .to(v.look, { x: lookB.x, y: lookB.y, z: lookB.z, duration: 3.6, ease: 'power1.inOut' }, 0)
      .call(stage('starter'), null, .6)
      .to(st, { rpm: 1, duration: 2.6, ease: 'power2.in' }, .6)
      .to(st, { vib: 1, duration: 1.0 }, .8)
      .to(st, { blur: .58, duration: 1.4, ease: 'power2.in' }, 1.6)
      .call(() => { st.landingOn = true; }, null, 1.8)
      .call(stage('rotor'), null, 2.0)
      .to(st, { dust: .75, duration: 1.0 }, 1.9)
      .to(st, { vib: 0, duration: .8 }, 2.9)
      .call(stage('takeoff'), null, 3.1)
      .to(v.pos, { y: .9, duration: 1.1, ease: 'power2.inOut' }, 3.1)
      .to(v.rot, { x: -.07, z: -.05, duration: 1.1, ease: 'power2.inOut' }, 3.1)
      .to(st, { shadow: 0, duration: 1.1 }, 3.2)
      .to(st, { dust: 0, duration: 1.0 }, 3.4)
      .to(flight, { u: 1, duration: 2.9, ease: 'power2.inOut', onUpdate: () => {
        const u = flight.u; const p = path.getPoint(u); v.pos.copy(p);
        const tan = path.getTangent(u);
        const heading = Math.atan2(-tan.z, tan.x);
        const blend = smooth(clamp((u - .55) / .45, 0, 1));
        let yaw = heading; let d = P.yaw - yaw; while (d > PI) d -= PI * 2; while (d < -PI) d += PI * 2;
        yaw = yaw + d * blend;
        v.rot.y = yaw;
        v.rot.x = -Math.sin(u * PI) * .38 * (1 - blend) + (1 - blend) * -.05;
        v.rot.z = -.28 * Math.sin(u * PI) * (1 - blend);
      } }, 4.0)
      .call(stage('climb'), null, 4.3)
      .to(v.cam, { x: P.cam.x, y: P.cam.y, z: P.cam.z, duration: 2.6, ease: 'power2.inOut' }, 4.1)
      .to(v.look, { x: P.look.x, y: P.look.y, z: P.look.z, duration: 2.6, ease: 'power2.inOut' }, 4.1)
      .to(st, { pad: 0, duration: .9 }, 3.9)
      .call(() => { st.landingOn = false; }, null, 5.0)
      .call(() => onReveal && onReveal(), null, 4.75)
      .call(() => { v.setPreset('hero'); v.hover.amount = 0; v.pos.copy(P.pos); v.rot.set(0, P.yaw, 0); v.cam.copy(P.cam); v.look.copy(P.look); }, null, 6.9)
      .to(v.hover, { amount: 1, duration: 1.2, ease: 'power1.inOut' }, 6.95);
    return tl;
  }
  /* -------- inner pages: quick fly-through across a full-screen overlay -------- */
  flyby(v, { onDone, dir = 1 } = {}) {
    const gs = G(), st = v.st;
    v.setPreset('manual'); v.scale = 1;
    Object.assign(st, { rpm: 1, blur: .6, lightsOn: true, landingOn: true, ground: 0, shadow: 0, pad: 0, dust: 0 });
    const m = this.mobile;
    v.cam.set(0, 1.5, m ? 20 : 16); v.look.set(0, .4, 0);
    v.pos.set(-13 * dir, -5, 2); v.rot.set(-.3 * dir, dir > 0 ? .25 : PI - .25, -.3);
    const tl = gs.timeline({ onComplete: () => { onDone && onDone(); } });
    this.tl = tl;
    tl.to(v.pos, { x: 12 * dir, y: 6.5, z: -4, duration: 1.9, ease: 'power2.inOut' }, 0)
      .to(v.rot, { x: -.05 * dir, z: -.12, duration: 1.4, ease: 'power2.inOut' }, .3)
      .to(v.rot, { y: dir > 0 ? .9 : PI - .9, duration: 1.9, ease: 'power1.inOut' }, 0)
      .to(v.look, { x: 1.5 * dir, y: 2.5, duration: 1.9, ease: 'power1.inOut' }, 0);
    return tl;
  }
  skipIntro() { if (this.tl && this.tl.progress() < 1) this.tl.timeScale(6); }
  dispose() { this.stop(); document.removeEventListener('visibilitychange', this.onVis); this.renderer.dispose(); }
}

/* ---------------- procedural cockpit audio ---------------- */
export class AudioEngine {
  constructor() { this.ctx = null; this.ready = false; this.muted = false; this.rpm = 0; }
  unlock() {
    try {
      if (!this.ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false; this.ctx = new AC(); this.build(); }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.ready = true; return true;
    } catch (e) { return false; }
  }
  noiseBuffer(brown) {
    const c = this.ctx, len = c.sampleRate * 2, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + .02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    return b;
  }
  build() {
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = .9; this.master.connect(c.destination);
    // turbine: filtered white noise + rising whine
    const nz = c.createBufferSource(); nz.buffer = this.noiseBuffer(false); nz.loop = true;
    this.tFilter = c.createBiquadFilter(); this.tFilter.type = 'bandpass'; this.tFilter.frequency.value = 600; this.tFilter.Q.value = 1.4;
    this.tGain = c.createGain(); this.tGain.gain.value = 0;
    nz.connect(this.tFilter); this.tFilter.connect(this.tGain); this.tGain.connect(this.master); nz.start();
    this.whine = c.createOscillator(); this.whine.type = 'sawtooth'; this.whine.frequency.value = 80;
    this.whine2 = c.createOscillator(); this.whine2.type = 'sine'; this.whine2.frequency.value = 160;
    this.wFilter = c.createBiquadFilter(); this.wFilter.type = 'lowpass'; this.wFilter.frequency.value = 1800;
    this.wGain = c.createGain(); this.wGain.gain.value = 0;
    this.whine.connect(this.wFilter); this.whine2.connect(this.wFilter); this.wFilter.connect(this.wGain); this.wGain.connect(this.master); this.whine.start(); this.whine2.start();
    // rotor thump: brown noise modulated at the blade-pass frequency
    const bn = c.createBufferSource(); bn.buffer = this.noiseBuffer(true); bn.loop = true;
    this.rFilter = c.createBiquadFilter(); this.rFilter.type = 'lowpass'; this.rFilter.frequency.value = 220;
    this.rMod = c.createGain(); this.rMod.gain.value = 0;
    this.rGain = c.createGain(); this.rGain.gain.value = 0;
    this.lfo = c.createOscillator(); this.lfo.type = 'sine'; this.lfo.frequency.value = 1;
    this.lfoGain = c.createGain(); this.lfoGain.gain.value = .5;
    this.lfo.connect(this.lfoGain); this.lfoGain.connect(this.rMod.gain);
    bn.connect(this.rFilter); this.rFilter.connect(this.rMod); this.rMod.connect(this.rGain); this.rGain.connect(this.master); bn.start(); this.lfo.start();
    this.setRPM(0, true);
  }
  setRPM(r, instant = false) {
    if (!this.ctx) return; this.rpm = r;
    const c = this.ctx, t = c.currentTime, k = instant ? .001 : .12;
    const s = (p, val) => p.setTargetAtTime(val, t, k);
    s(this.tFilter.frequency, 500 + r * 2200); s(this.tGain.gain, clamp(r, 0, 1) * .34);
    s(this.whine.frequency, 60 + r * r * 1300); s(this.whine2.frequency, 120 + r * r * 2600); s(this.wGain.gain, Math.pow(r, 1.5) * .07); s(this.wFilter.frequency, 800 + r * 3200);
    s(this.lfo.frequency, .5 + r * 19); s(this.rMod.gain, .5 + r * .5); s(this.rGain.gain, Math.pow(clamp((r - .08) / .92, 0, 1), .8) * .75); s(this.rFilter.frequency, 120 + r * 220);
  }
  env(node, peak, a, d, when = 0) { const c = this.ctx, t = c.currentTime + when; node.gain.cancelScheduledValues(t); node.gain.setValueAtTime(0, t); node.gain.linearRampToValueAtTime(peak, t + a); node.gain.exponentialRampToValueAtTime(.0001, t + a + d); }
  click() {
    if (!this.ctx) return; const c = this.ctx;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 1400; const g = c.createGain(); o.connect(g); g.connect(this.master); this.env(g, .25, .002, .04); o.start(); o.stop(c.currentTime + .08);
    const n = c.createBufferSource(); n.buffer = this.noiseBuffer(false); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500; const g2 = c.createGain(); n.connect(f); f.connect(g2); g2.connect(this.master); this.env(g2, .5, .001, .05); n.start(); n.stop(c.currentTime + .08);
  }
  beep(freq = 880, dur = .09, vol = .18, when = 0) {
    if (!this.ctx) return; const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = freq; const g = c.createGain(); o.connect(g); g.connect(this.master); this.env(g, vol, .008, dur, when); o.start(c.currentTime + when); o.stop(c.currentTime + when + dur + .05);
  }
  chime() { this.beep(660, .12, .16, 0); this.beep(990, .16, .16, .13); }
  buzz(dur = .35) {
    if (!this.ctx) return; const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 95; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; const g = c.createGain(); o.connect(f); f.connect(g); g.connect(this.master); this.env(g, .12, .01, dur); o.start(); o.stop(c.currentTime + dur + .1);
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : .9, this.ctx.currentTime, .05); }
  fadeOut(d = 1.2) { if (this.master) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, d / 3); }
  fadeIn(d = .6) { if (this.master && !this.muted) this.master.gain.setTargetAtTime(.9, this.ctx.currentTime, d / 3); }
}

/* ---------------- capability check + bootstrap ---------------- */
export function webglOK() {
  try { const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return false; const dbg = gl.getExtension('WEBGL_debug_renderer_info'); const r = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : ''; return !/SwiftShader|llvmpipe/i.test(r) || !!window.__hh3dForce; } catch (e) { return false; }
}
let engine = null;
function getEngine(o) { if (!engine) engine = new Engine(o); return engine; }
window.HH3D = { THREE, Engine, View, AudioEngine, PRESETS, getEngine, buildHelicopter, webglOK };
const fontsReady = (document.fonts && document.fonts.load) ? Promise.race([document.fonts.load('800 52px Manrope').then(() => document.fonts.load('900 92px Unbounded')), new Promise((r) => setTimeout(r, 900))]) : Promise.resolve();
fontsReady.then(() => { if (window.__hh3dResolve) window.__hh3dResolve(window.HH3D); });
