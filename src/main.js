import * as THREE from 'three';
import { sfx, setMuted, isMuted } from './audio.js';

/* ============================================================
   RUSTFALL — Rust-inspired browser survival (PC + mobile)
   Single-player prototype: gather / craft / build / fight bots
   ============================================================ */

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

const SAVE_KEY = 'rustfall-v1';
const WORLD_R = 115;           // playable half-extent
const DAY_LEN = 480;           // seconds per full day

// ---------- persistent state ----------
const S = {
  mode: 'menu',                // menu | playing | dead
  inv: { wood: 0, stone: 0, scrap: 0, cloth: 0, meat: 0, ammo: 0, medkit: 0 },
  owned: { rock: true, hatchet: false, pickaxe: false, rifle: false },
  health: 100, hunger: 100, kills: 0, deaths: 0,
  sel: 0, buildRot: 0,
  sens: 1.4, quality: 'auto', muted: false,
  time: 0.32,                  // day fraction (0.25 = sunrise)
};
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      inv: S.inv, owned: S.owned, health: S.health, hunger: S.hunger,
      kills: S.kills, deaths: S.deaths, sens: S.sens, quality: S.quality, muted: S.muted,
    }));
  } catch {}
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!d) return;
    Object.assign(S.inv, d.inv || {});
    Object.assign(S.owned, d.owned || {});
    S.health = d.health ?? 100; S.hunger = d.hunger ?? 100;
    S.kills = d.kills || 0; S.deaths = d.deaths || 0;
    S.sens = d.sens ?? 1.4; S.quality = d.quality || 'auto'; S.muted = !!d.muted;
  } catch {}
}
load();
setMuted(S.muted);

// ---------- three setup ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5d6);
scene.fog = new THREE.Fog(0x87b5d6, 40, 190);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 600);
scene.add(camera);

const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x4a5a3a, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2e0, 1.8);
sun.position.set(60, 90, 30);
sun.castShadow = false;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
sun.shadow.camera.far = 300;
scene.add(sun);
scene.add(sun.target);
const muzzle = new THREE.PointLight(0xffc36b, 0, 18);
scene.add(muzzle);

function applyQuality() {
  let q = S.quality;
  if (q === 'auto') q = (IS_TOUCH || innerWidth < 820) ? 'low' : 'high';
  if (q === 'low') {
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.2));
    renderer.shadowMap.enabled = false; sun.castShadow = false;
  } else {
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true; sun.castShadow = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
  }
}
applyQuality();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setSize(innerWidth, innerHeight);

// ---------- terrain ----------
function groundH(x, z) {
  let h = 2.4
    + Math.sin(x * 0.05) * Math.cos(z * 0.045) * 1.7
    + Math.sin(x * 0.013 + 1.7) * 1.3
    + Math.cos(z * 0.017 + 0.6) * 1.3;
  // flatten a pad for the monument (gas station) so buildings sit level
  const d = Math.hypot(x, z);
  if (d < 24) {
    const t = THREE.MathUtils.smoothstep(d, 10, 24); // 0 near center → 1 outside
    h = THREE.MathUtils.lerp(2.9, h, t);
  }
  return h;
}
const WATER_Y = 0.9;
{
  const SEG = 110, SIZE = 250;
  const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cGrass = new THREE.Color(0x5d8a46), cDry = new THREE.Color(0x9aa04e),
        cSand = new THREE.Color(0xd6c189), cRock = new THREE.Color(0x8a8d90),
        cSnow = new THREE.Color(0xe8eef2), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = groundH(x, z);
    pos.setY(i, h);
    const n = Math.sin(x * 0.11) * Math.cos(z * 0.09);
    if (h < 1.25) tmp.copy(cSand);
    else if (h < 3.6) tmp.copy(cGrass).lerp(cDry, THREE.MathUtils.clamp((n + 1) / 2 * 0.6, 0, 0.6));
    else if (h < 5.8) tmp.copy(cRock).lerp(cGrass, 0.25);
    else tmp.copy(cSnow);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  m.receiveShadow = true;
  m.userData.ground = true;
  scene.add(m);
  window.__ground = m;

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE, SIZE),
    new THREE.MeshStandardMaterial({ color: 0x2e6f9e, transparent: true, opacity: 0.75, roughness: 0.25, metalness: 0.1 })
  );
  water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y;
  scene.add(water);

  // distant sea skirt
  const sea = new THREE.Mesh(
    new THREE.RingGeometry(140, 600, 32),
    new THREE.MeshBasicMaterial({ color: 0x1d4e73, transparent: true, opacity: 0.9 })
  );
  sea.rotation.x = -Math.PI / 2; sea.position.y = WATER_Y - 0.05;
  scene.add(sea);
}

// ---------- shared materials / geometry ----------
const M = {
  trunk: new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 }),
  pine: new THREE.MeshStandardMaterial({ color: 0x2e6b34, roughness: 1 }),
  pine2: new THREE.MeshStandardMaterial({ color: 0x3a7d40, roughness: 1 }),
  rock: new THREE.MeshStandardMaterial({ color: 0x8d9094, roughness: 1, flatShading: true }),
  rockDark: new THREE.MeshStandardMaterial({ color: 0x5f6266, roughness: 1, flatShading: true }),
  barrel: new THREE.MeshStandardMaterial({ color: 0xc9511f, roughness: 0.7, metalness: 0.3 }),
  barrelBlue: new THREE.MeshStandardMaterial({ color: 0x2b6cb0, roughness: 0.7, metalness: 0.3 }),
  rad: new THREE.MeshStandardMaterial({ color: 0x39ff6a, emissive: 0x1aff4d, emissiveIntensity: 1.4 }),
  hemp: new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 1, side: THREE.DoubleSide }),
  crate: new THREE.MeshStandardMaterial({ color: 0x7d5027, roughness: 1 }),
  wall: new THREE.MeshStandardMaterial({ color: 0x8a6844, roughness: 1 }),
  botBody: new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.8 }),
  botHead: new THREE.MeshStandardMaterial({ color: 0xd8b58c, roughness: 0.9 }),
  gun: new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.6 }),
  boar: new THREE.MeshStandardMaterial({ color: 0x5a3d2b, roughness: 1 }),
  deer: new THREE.MeshStandardMaterial({ color: 0x9c7a54, roughness: 1 }),
};
const G = {
  trunk: new THREE.CylinderGeometry(0.28, 0.42, 3.2, 7),
  cone: new THREE.ConeGeometry(1.7, 2.8, 8),
  cone2: new THREE.ConeGeometry(1.2, 2.0, 8),
  rock: new THREE.DodecahedronGeometry(1, 0),
  barrel: new THREE.CylinderGeometry(0.55, 0.55, 1.3, 12),
  hemp: new THREE.ConeGeometry(0.5, 1.4, 6),
  crate: new THREE.BoxGeometry(1.2, 1.2, 1.2),
  botBody: new THREE.CylinderGeometry(0.42, 0.5, 1.15, 8),
  botHead: new THREE.SphereGeometry(0.3, 10, 8),
  boarBody: new THREE.BoxGeometry(1.2, 0.7, 0.6),
  wall: new THREE.BoxGeometry(3, 2.6, 0.25),
};

// ---------- entity stores ----------
const nodes = [];       // harvestables {kind,hp,maxHp,pos,mesh,r,respawn}
const colliders = [];   // {x,z,r,wall?}
const shootables = [];  // meshes for raycast (userData.ent)
const bots = [];
const animals = [];
const tracers = [];
const parts = [];
const walls = [];
const respawnQueue = [];

function rand(a, b) { return a + Math.random() * (b - a); }
function farFromOthers(x, z, list, d) {
  for (const e of list) { const dx = e.pos.x - x, dz = e.pos.z - z; if (dx * dx + dz * dz < d * d) return false; }
  return true;
}
function clearOfCenter(x, z, r) { return (x * x + z * z) > r * r; }

function makeTree(x, z) {
  const y = groundH(x, z);
  const grp = new THREE.Group();
  const trunk = new THREE.Mesh(G.trunk, M.trunk);
  trunk.position.y = 1.6; trunk.castShadow = true; grp.add(trunk);
  const c1 = new THREE.Mesh(G.cone, Math.random() < 0.5 ? M.pine : M.pine2);
  c1.position.y = 4.0; c1.castShadow = true; grp.add(c1);
  const c2 = new THREE.Mesh(G.cone2, M.pine);
  c2.position.y = 5.5; c2.castShadow = true; grp.add(c2);
  const s = rand(0.8, 1.5); grp.scale.setScalar(s);
  grp.position.set(x, y - 0.1, z);
  grp.rotation.y = rand(0, 6.28);
  scene.add(grp);
  const ent = { kind: 'tree', hp: 6, maxHp: 6, pos: new THREE.Vector3(x, y, z), mesh: grp, r: 0.7 * s };
  grp.traverse(o => { if (o.isMesh) { o.userData.ent = ent; shootables.push(o); } });
  nodes.push(ent); colliders.push({ x, z, r: ent.r + 0.25 });
  return ent;
}
function makeRockNode(x, z, big = false) {
  const y = groundH(x, z);
  const m = new THREE.Mesh(G.rock, Math.random() < 0.5 ? M.rock : M.rockDark);
  const s = big ? rand(1.6, 2.4) : rand(0.9, 1.5);
  m.scale.set(s, s * rand(0.7, 1), s);
  m.position.set(x, y + s * 0.35, z);
  m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  const ent = { kind: 'rock', hp: 6, maxHp: 6, pos: new THREE.Vector3(x, y, z), mesh: m, r: s };
  m.userData.ent = ent; shootables.push(m);
  nodes.push(ent); colliders.push({ x, z, r: s * 0.9 });
  return ent;
}
function makeBarrel(x, z) {
  const y = groundH(x, z);
  const m = new THREE.Mesh(G.barrel, Math.random() < 0.5 ? M.barrel : M.barrelBlue);
  m.position.set(x, y + 0.65, z); m.castShadow = true;
  scene.add(m);
  const ent = { kind: 'barrel', hp: 3, maxHp: 3, pos: new THREE.Vector3(x, y, z), mesh: m, r: 0.7 };
  m.userData.ent = ent; shootables.push(m);
  nodes.push(ent); colliders.push({ x, z, r: 0.75 });
  return ent;
}
function makeHemp(x, z) {
  const y = groundH(x, z);
  const m = new THREE.Mesh(G.hemp, M.hemp);
  m.position.set(x, y + 0.7, z);
  const s = rand(0.8, 1.3); m.scale.setScalar(s);
  scene.add(m);
  const ent = { kind: 'hemp', hp: 1, maxHp: 1, pos: new THREE.Vector3(x, y, z), mesh: m, r: 0.4 };
  m.userData.ent = ent; shootables.push(m);
  nodes.push(ent);
  return ent;
}
function makeCrate(x, z, y0) {
  const y = y0 ?? groundH(x, z);
  const m = new THREE.Mesh(G.crate, M.crate);
  m.position.set(x, y + 0.6, z); m.rotation.y = rand(0, 3);
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  const ent = { kind: 'crate', hp: 2, maxHp: 2, pos: new THREE.Vector3(x, y, z), mesh: m, r: 0.9 };
  m.userData.ent = ent; shootables.push(m);
  nodes.push(ent); colliders.push({ x, z, r: 0.95 });
  return ent;
}

function scatterWorld() {
  let tries = 0;
  const placed = [];
  while (placed.length < 90 && tries++ < 1500) {
    const x = rand(-110, 110), z = rand(-110, 110);
    const h = groundH(x, z);
    if (h < 1.3 || !clearOfCenter(x, z, 17)) continue;
    if (!farFromOthers(x, z, placed, 5)) continue;
    placed.push({ pos: { x, z } }); makeTree(x, z);
  }
  tries = 0; const rp = [];
  while (rp.length < 55 && tries++ < 1200) {
    const x = rand(-110, 110), z = rand(-110, 110);
    const h = groundH(x, z);
    if (h < 1.1 || h > 5.6 || !clearOfCenter(x, z, 15)) continue;
    if (!farFromOthers(x, z, rp, 6)) continue;
    rp.push({ pos: { x, z } }); makeRockNode(x, z, Math.random() < 0.18);
  }
  for (let i = 0; i < 26; i++) {
    const x = rand(-100, 100), z = rand(-100, 100);
    if (groundH(x, z) < 1.1 || !clearOfCenter(x, z, 13)) { continue; }
    makeBarrel(x, z);
  }
  for (let i = 0; i < 34; i++) {
    const x = rand(-105, 105), z = rand(-105, 105);
    if (groundH(x, z) < 1.25 || !clearOfCenter(x, z, 14)) continue;
    makeHemp(x, z);
  }
  // ---- monument: abandoned gas station at origin ----
  const slab = new THREE.Mesh(new THREE.BoxGeometry(20, 0.4, 14), new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 1 }));
  slab.position.set(0, groundH(0, 0) + 0.1, 0); slab.receiveShadow = true;
  scene.add(slab);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xb03a2a, roughness: 0.8 });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(18, 0.5, 12), roofMat);
  roof.position.set(0, slab.position.y + 5.4, 0); roof.castShadow = true; scene.add(roof);
  const pilMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.9 });
  [[-8, -5], [8, -5], [-8, 5], [8, 5]].forEach(([px, pz]) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 5.2, 8), pilMat);
    p.position.set(px, slab.position.y + 2.8, pz); p.castShadow = true; scene.add(p);
    colliders.push({ x: px, z: pz, r: 0.6 });
  });
  for (let i = 0; i < 7; i++) makeCrate(rand(-7, 7), rand(-4.5, 4.5), slab.position.y + 0.2);
  for (let i = 0; i < 5; i++) {
    const x = rand(-9, 9), z = rand(6, 11);
    const m = new THREE.Mesh(G.barrel, M.rad);
    m.position.set(x, groundH(x, z) + 0.65, z); scene.add(m);
    const ent = { kind: 'radbarrel', hp: 3, maxHp: 3, pos: new THREE.Vector3(x, m.position.y, z), mesh: m, r: 0.7 };
    m.userData.ent = ent; shootables.push(m); nodes.push(ent); colliders.push({ x, z, r: 0.75 });
  }
  // wrecked car (cover)
  const car = new THREE.Group();
  const bodyM = new THREE.MeshStandardMaterial({ color: 0x4a6b8a, roughness: 0.6, metalness: 0.4 });
  const cb = new THREE.Mesh(new THREE.BoxGeometry(4, 0.9, 1.8), bodyM); cb.position.y = 0.8; cb.castShadow = true; car.add(cb);
  const ct = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 1.6), bodyM); ct.position.set(-0.2, 1.55, 0); car.add(ct);
  const wg = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10); wg.rotateX(Math.PI / 2);
  const wm = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1 });
  [[-1.4, 0.95], [1.4, 0.95], [-1.4, -0.95], [1.4, -0.95]].forEach(([wx, wz]) => {
    const w = new THREE.Mesh(wg, wm); w.position.set(wx, 0.42, wz); car.add(w);
  });
  car.position.set(14, groundH(14, 8), 8); car.rotation.y = 0.6;
  scene.add(car); colliders.push({ x: 14, z: 8, r: 2.4 });
}
scatterWorld();

// ---------- bots (hostile scavengers) ----------
function spawnBot(i) {
  const a = (i / 6) * Math.PI * 2;
  const x = Math.cos(a) * rand(22, 42), z = Math.sin(a) * rand(22, 42);
  const grp = new THREE.Group();
  const body = new THREE.Mesh(G.botBody, M.botBody); body.position.y = 0.95; body.castShadow = true; grp.add(body);
  const head = new THREE.Mesh(G.botHead, M.botHead); head.position.y = 1.85; head.castShadow = true; grp.add(head);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6),
    new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 2 }));
  lamp.position.set(0, 1.85, 0.28); grp.add(lamp);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.9), M.gun);
  gun.position.set(0.35, 1.2, 0.5); grp.add(gun);
  grp.position.set(x, groundH(x, z), z);
  scene.add(grp);
  const ent = {
    kind: 'bot', hp: 100, maxHp: 100, pos: grp.position, mesh: grp, r: 0.6,
    state: 'wander', tx: x, tz: z, shootT: rand(1, 2.5), dead: false, speed: rand(2.2, 3),
    lamp,
  };
  grp.traverse(o => { if (o.isMesh) { o.userData.ent = ent; shootables.push(o); } });
  bots.push(ent);
  return ent;
}
for (let i = 0; i < 6; i++) spawnBot(i);

// ---------- animals ----------
function spawnAnimal() {
  const x = rand(-100, 100), z = rand(-100, 100);
  if (groundH(x, z) < 1.3 || !clearOfCenter(x, z, 18)) return null;
  const deer = Math.random() < 0.4;
  const grp = new THREE.Group();
  const body = new THREE.Mesh(G.boarBody, deer ? M.deer : M.boar);
  body.position.y = 0.75; body.castShadow = true; grp.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), deer ? M.deer : M.boar);
  head.position.set(0.8, 1.0, 0); grp.add(head);
  if (deer) {
    const legG = new THREE.BoxGeometry(0.12, 0.5, 0.12);
    [[0.4, 0.2], [0.4, -0.2], [-0.4, 0.2], [-0.4, -0.2]].forEach(([lx, lz]) => {
      const l = new THREE.Mesh(legG, M.deer); l.position.set(lx, 0.25, lz); grp.add(l);
    });
  }
  grp.position.set(x, groundH(x, z), z);
  grp.rotation.y = rand(0, 6.28);
  scene.add(grp);
  const ent = {
    kind: 'animal', deer, hp: deer ? 50 : 80, maxHp: 80, pos: grp.position, mesh: grp, r: 0.8,
    tx: x, tz: z, wait: rand(1, 4), dead: false, aggressive: !deer,
  };
  grp.traverse(o => { if (o.isMesh) { o.userData.ent = ent; shootables.push(o); } });
  animals.push(ent);
  return ent;
}
for (let i = 0; i < 8; i++) spawnAnimal();

// ---------- player ----------
const player = {
  pos: new THREE.Vector3(90, 5, 60),
  vel: new THREE.Vector3(),
  yaw: Math.PI * 0.75, pitch: 0,
  onGround: false, hp: S.health, hunger: S.hunger,
  swing: 0, shootCd: 0, hitCd: 0, radWarn: 0, hurtT: 0,
};
function spawnPoint() {
  for (let i = 0; i < 60; i++) {
    const a = rand(0, Math.PI * 2), r = rand(88, 105);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (groundH(x, z) > 1.4) return new THREE.Vector3(x, groundH(x, z) + 0.1, z);
  }
  return new THREE.Vector3(90, 5, 60);
}
player.pos.copy(spawnPoint());
player.yaw = Math.atan2(player.pos.x, player.pos.z); // face island center

// ---------- viewmodel tools ----------
const vm = new THREE.Group();
camera.add(vm);
vm.position.set(0.42, -0.42, -0.7);
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); return m;
}
const vmTools = {};
{
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12, 0),
    new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 1, flatShading: true }));
  const g1 = new THREE.Group(); g1.add(rock); vmTools.rock = g1;
  const hat = new THREE.Group();
  hat.add(box(0.05, 0.4, 0.05, new THREE.MeshStandardMaterial({ color: 0x7a5230 }), 0, 0, 0));
  hat.add(box(0.22, 0.09, 0.05, new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6, roughness: 0.4 }), 0.08, 0.16, 0));
  vmTools.hatchet = hat;
  const pk = new THREE.Group();
  pk.add(box(0.05, 0.42, 0.05, new THREE.MeshStandardMaterial({ color: 0x7a5230 }), 0, 0, 0));
  pk.add(box(0.3, 0.05, 0.05, new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.6, roughness: 0.4 }), 0, 0.18, 0));
  vmTools.pickaxe = pk;
  const ri = new THREE.Group();
  const wm2 = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.5, roughness: 0.5 });
  const woodM = new THREE.MeshStandardMaterial({ color: 0x6e4a2a, roughness: 0.9 });
  ri.add(box(0.07, 0.1, 0.62, woodM, 0, 0, 0));
  ri.add(box(0.05, 0.05, 0.4, wm2, 0, 0.05, -0.1));
  vmTools.rifle = ri;
  const bd = new THREE.Group();
  bd.add(box(0.16, 0.05, 0.16, new THREE.MeshStandardMaterial({ color: 0xffffff }), 0, 0, 0));
  bd.add(box(0.05, 0.056, 0.16, new THREE.MeshStandardMaterial({ color: 0xe5484d }), 0, 0, 0));
  vmTools.bandage = bd;
  const pl = new THREE.Group();
  pl.add(box(0.3, 0.22, 0.02, new THREE.MeshStandardMaterial({ color: 0x4a90d9, transparent: true, opacity: 0.8 }), 0, 0, 0));
  vmTools.plan = pl;
  for (const k of Object.keys(vmTools)) { vmTools[k].visible = false; vm.add(vmTools[k]); }
}
const HOTBAR = [
  { id: 'rock', ico: '🪨', name: 'Rock' },
  { id: 'hatchet', ico: '🪓', name: 'Hatchet' },
  { id: 'pickaxe', ico: '⛏️', name: 'Pickaxe' },
  { id: 'rifle', ico: '🔫', name: 'Rifle' },
  { id: 'bandage', ico: '💊', name: 'Bandage' },
  { id: 'plan', ico: '📐', name: 'Build' },
];
function updateViewmodel() {
  const id = HOTBAR[S.sel].id;
  const locked = (id === 'hatchet' && !S.owned.hatchet) || (id === 'pickaxe' && !S.owned.pickaxe) || (id === 'rifle' && !S.owned.rifle);
  for (const k of Object.keys(vmTools)) vmTools[k].visible = false;
  if (!locked && vmTools[id]) vmTools[id].visible = true;
  else vmTools.rock.visible = true;
}

// ---------- ghost wall ----------
const ghost = new THREE.Mesh(G.wall, new THREE.MeshStandardMaterial({ color: 0x5ad97a, transparent: true, opacity: 0.5 }));
ghost.visible = false;
scene.add(ghost);

// ---------- FX pools ----------
const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95 });
function spawnTracer(a, b, color = 0xffe08a) {
  const g = new THREE.BufferGeometry().setFromPoints([a, b]);
  const l = new THREE.Line(g, tracerMat.clone());
  l.material.color.setHex(color);
  scene.add(l);
  tracers.push({ mesh: l, life: 0.12 });
}
for (let i = 0; i < 50; i++) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09),
    new THREE.MeshBasicMaterial({ color: 0xffd27a }));
  m.visible = false; scene.add(m);
  parts.push({ mesh: m, vel: new THREE.Vector3(), life: 0 });
}
function burst(p, color = 0xffd27a, n = 8) {
  let c = 0;
  for (const pt of parts) {
    if (pt.life > 0) continue;
    pt.life = rand(0.3, 0.7); pt.mesh.visible = true;
    pt.mesh.material.color.setHex(color);
    pt.mesh.position.copy(p);
    pt.vel.set(rand(-3, 3), rand(1, 4), rand(-3, 3));
    if (++c >= n) break;
  }
}

// ---------- UI helpers ----------
function toast(msg, ms = 2200) {
  const d = document.createElement('div');
  d.className = 'toastmsg'; d.textContent = msg;
  $('toast').appendChild(d);
  setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 300); }, ms);
  while ($('toast').children.length > 4) $('toast').firstChild.remove();
}
function feed(msg) {
  const d = document.createElement('div');
  d.className = 'feedmsg'; d.innerHTML = msg;
  $('feed').prepend(d);
  while ($('feed').children.length > 5) $('feed').lastChild.remove();
  setTimeout(() => { d.style.opacity = '0.4'; }, 6000);
}
const RES_META = [
  ['wood', '🪵', 'Wood'], ['stone', '🪨', 'Stone'], ['scrap', '⚙️', 'Scrap'],
  ['cloth', '🧵', 'Cloth'], ['meat', '🍖', 'Meat'], ['ammo', '🔸', 'Ammo'], ['medkit', '💊', 'Meds'],
];
const RECIPES = [
  { id: 'hatchet', name: '🪓 Hatchet — chop x1.6', cost: { wood: 200, stone: 100 }, once: true, can: () => !S.owned.hatchet },
  { id: 'pickaxe', name: '⛏️ Pickaxe — mine x1.6', cost: { wood: 200, stone: 100 }, once: true, can: () => !S.owned.pickaxe },
  { id: 'rifle', name: '🔫 Rifle + 20 ammo', cost: { stone: 400, scrap: 100 }, once: true, can: () => !S.owned.rifle },
  { id: 'ammo', name: '🔸 Ammo × 20', cost: { stone: 50, scrap: 20 }, can: () => S.owned.rifle },
  { id: 'medkit', name: '💊 Bandage (+40 HP)', cost: { cloth: 40 }, can: () => true },
  { id: 'wall', name: '🧱 Wall kit — 100 wood each (auto)', cost: {}, can: () => false, info: 'Select 📐 Build, aim, click to place (50 wood).' },
];
function canAfford(cost) { for (const k in cost) if ((S.inv[k] || 0) < cost[k]) return false; return true; }
function pay(cost) { for (const k in cost) S.inv[k] -= cost[k]; }
function renderHotbar() {
  const hb = $('hotbar'); hb.innerHTML = '';
  HOTBAR.forEach((h, i) => {
    const locked = (h.id === 'hatchet' && !S.owned.hatchet) || (h.id === 'pickaxe' && !S.owned.pickaxe) || (h.id === 'rifle' && !S.owned.rifle);
    const d = document.createElement('div');
    d.className = 'slot' + (i === S.sel ? ' active' : '');
    d.innerHTML = `<span class="key">${i + 1}</span><span class="ico">${locked ? '🔒' : h.ico}</span><span class="nm">${locked ? 'craft' : h.name}</span>${h.id === 'rifle' ? `<span class="ammo">${S.inv.ammo}</span>` : ''}`;
    d.onclick = () => { S.sel = i; renderHotbar(); updateViewmodel(); };
    hb.appendChild(d);
  });
}
function renderInv() {
  $('resGrid').innerHTML = RES_META.map(([k, ico, nm]) =>
    `<div class="res"><b>${ico} ${S.inv[k] || 0}</b><div>${nm}</div></div>`).join('');
  $('craftList').innerHTML = '';
  const wallHint = document.createElement('div');
  wallHint.className = 'craft';
  wallHint.innerHTML = `<div><b>🧱 Wall kit</b><br/><span style="color:var(--muted)">Select 📐 Build, aim, click to place (50 wood each).</span></div>`;
  $('craftList').appendChild(wallHint);
  RECIPES.forEach(r => {
    if (r.id === 'wall' || !r.can()) return;
    const row = document.createElement('div');
    row.className = 'craft';
    const costStr = Object.entries(r.cost).map(([k, v]) => `${v} ${k}`).join(' + ') || r.info || '';
    row.innerHTML = `<div><b>${r.name}</b><br/><span style="color:var(--muted)">${costStr}</span></div>`;
    const b = document.createElement('button');
    b.className = 'btn small'; b.textContent = 'Craft';
    b.disabled = !canAfford(r.cost);
    b.style.opacity = b.disabled ? 0.45 : 1;
    b.onclick = () => craft(r.id);
    row.appendChild(b);
    $('craftList').appendChild(row);
  });
}
function craft(id) {
  if (id === 'wall') return;
  const r = RECIPES.find(x => x.id === id);
  if (!r || !canAfford(r.cost)) { toast('Not enough resources'); return; }
  pay(r.cost);
  if (id === 'hatchet') S.owned.hatchet = true;
  else if (id === 'pickaxe') S.owned.pickaxe = true;
  else if (id === 'rifle') { S.owned.rifle = true; S.inv.ammo += 20; S.sel = 3; }
  else if (id === 'ammo') S.inv.ammo += 20;
  else if (id === 'medkit') S.inv.medkit += 1;
  sfx('craft'); toast('Crafted ' + r.name.split('—')[0]);
  save(); renderHotbar(); renderInv(); updateViewmodel();
}
function eatFood() {
  if (S.inv.meat > 0) {
    S.inv.meat--; S.hunger = Math.min(100, S.hunger + 30); player.hp = Math.min(100, player.hp + 8);
    sfx('eat'); toast('🍖 +30 food'); save();
  } else toast('No food — hit hemp / kill animals');
}
function useBandage() {
  if ((S.inv.medkit || 0) > 0 && player.hp < 100) {
    S.inv.medkit--; player.hp = Math.min(100, player.hp + 40);
    sfx('eat'); toast('💊 +40 HP');
  } else if ((S.inv.medkit || 0) <= 0) toast('No bandages — craft with 40 cloth');
}

// ---------- input: keyboard/mouse ----------
const keys = {};
addEventListener('keydown', (e) => {
  if (e.code === 'Tab') { e.preventDefault(); toggleInv(); return; }
  keys[e.code] = true;
  if (S.mode !== 'playing') return;
  if (e.code.startsWith('Digit')) {
    const n = +e.code.slice(5) - 1;
    if (n >= 0 && n < 6) { S.sel = n; renderHotbar(); updateViewmodel(); }
  }
  if (e.code === 'KeyF') eatFood();
  if (e.code === 'KeyE') doInteract();
  if (e.code === 'KeyB') { S.sel = 5; renderHotbar(); updateViewmodel(); }
  if (e.code === 'KeyR') S.buildRot += Math.PI / 4;
});
addEventListener('keyup', (e) => keys[e.code] = false);

let locked = false;
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
});
canvas.addEventListener('click', () => {
  if (S.mode === 'playing' && !IS_TOUCH && !locked && !$('inv').classList.contains('on'))
    canvas.requestPointerLock?.();
});
document.addEventListener('mousemove', (e) => {
  if (S.mode !== 'playing' || !locked) return;
  const s = 0.0022 * S.sens;
  player.yaw -= e.movementX * s;
  player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * s, -1.45, 1.45);
});
document.addEventListener('mousedown', (e) => {
  if (S.mode !== 'playing' || !locked || e.button !== 0) return;
  if ($('inv').classList.contains('on')) return;
  primaryAction();
});
function toggleInv(force) {
  const el = $('inv');
  const on = force ?? !el.classList.contains('on');
  el.classList.toggle('on', on);
  if (on) renderInv();
  if (!on && !IS_TOUCH && S.mode === 'playing') canvas.requestPointerLock?.();
}
$('invBtn').onclick = () => toggleInv();
$('invClose').onclick = () => toggleInv(false);

// ---------- input: touch ----------
const joy = { x: 0, y: 0, id: null };
let lookId = null, lookLX = 0, lookLY = 0;
if (IS_TOUCH) {
  const stick = $('stick'), nub = $('nub');
  const setNub = (dx, dy) => nub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  stick.addEventListener('touchstart', (e) => {
    e.preventDefault();
    joy.id = e.changedTouches[0].identifier;
  }, { passive: false });
  addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) {
        const r = stick.getBoundingClientRect();
        let dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2);
        const max = 48, len = Math.hypot(dx, dy) || 1;
        if (len > max) { dx = dx / len * max; dy = dy / len * max; }
        setNub(dx, dy);
        joy.x = dx / max; joy.y = dy / max;
      } else if (t.identifier === lookId) {
        const s = 0.0045 * S.sens;
        player.yaw -= (t.clientX - lookLX) * s;
        player.pitch = THREE.MathUtils.clamp(player.pitch - (t.clientY - lookLY) * s, -1.45, 1.45);
        lookLX = t.clientX; lookLY = t.clientY;
      }
    }
  }, { passive: true });
  addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) { joy.id = null; joy.x = joy.y = 0; setNub(0, 0); }
      if (t.identifier === lookId) lookId = null;
    }
  });
  $('lookPad').addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    lookId = t.identifier; lookLX = t.clientX; lookLY = t.clientY;
  }, { passive: true });
  const hold = (id, fn) => $(id).addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false });
  hold('btnFire', () => primaryAction());
  hold('btnAct', () => doInteract(true));
  hold('btnJump', () => { if (player.onGround) player.vel.y = 8; });
  hold('btnEat', () => eatFood());
  hold('btnBld', () => { S.sel = 5; renderHotbar(); updateViewmodel(); toast('📐 Build: aim + FIRE to place (50 wood), drag 🔄? use R on PC'); });
}

// ---------- combat / interact ----------
const ray = new THREE.Raycaster();
const fwd = new THREE.Vector3();
function aimRay(far) {
  camera.getWorldDirection(fwd);
  ray.set(camera.getWorldPosition(new THREE.Vector3()), fwd);
  ray.far = far;
  const hits = ray.intersectObjects(shootables, false);
  return hits[0] || null;
}
function toolMult(kind) {
  const id = HOTBAR[S.sel].id;
  if (kind === 'tree') return id === 'hatchet' ? 1.6 : 1;
  if (kind === 'rock') return id === 'pickaxe' ? 1.6 : 1;
  return 1;
}
function primaryAction() {
  if (S.mode !== 'playing') return;
  const id = HOTBAR[S.sel].id;
  if (id === 'bandage') { useBandage(); return; }
  if (id === 'plan') { tryPlaceWall(); return; }
  if (id === 'rifle') { fireRifle(); return; }
  meleeHit();
}
function meleeHit() {
  if (player.hitCd > 0) return;
  player.hitCd = 0.45; player.swing = 1;
  const id = HOTBAR[S.sel].id;
  sfx(id === 'rock' ? 'hit' : 'chop');
  const hit = aimRay(3.6);
  burst(camera.getWorldPosition(new THREE.Vector3()).add(fwd.clone().multiplyScalar(2)), 0xffffff, 2);
  if (!hit) return;
  const ent = hit.object.userData.ent;
  if (!ent || ent.dead) return;
  const mult = toolMult(ent.kind);
  damageEnt(ent, Math.round(rand(18, 26) * mult), hit.point, true);
  $('hitmark').classList.remove('show');
  void $('hitmark').offsetWidth;
  $('hitmark').classList.add('show');
}
function fireRifle() {
  if (!S.owned.rifle) { toast('🔒 Craft the rifle first (🎒)'); return; }
  if (player.shootCd > 0) return;
  if ((S.inv.ammo || 0) <= 0) { toast('No ammo — loot barrels & bots'); sfx('rock'); return; }
  player.shootCd = 0.28; player.swing = 1;
  S.inv.ammo--; renderHotbar();
  sfx('shot');
  player.pitch = Math.min(1.45, player.pitch + 0.02);
  const origin = camera.getWorldPosition(new THREE.Vector3());
  camera.getWorldDirection(fwd);
  ray.set(origin, fwd); ray.far = 120;
  // walls block: test wall meshes first via distance
  const hit = aimRay(120);
  muzzle.position.copy(origin).add(fwd.clone().multiplyScalar(0.8));
  muzzle.intensity = 30; setTimeout(() => muzzle.intensity = 0, 60);
  const end = hit ? hit.point : origin.clone().add(fwd.clone().multiplyScalar(100));
  spawnTracer(camera.getWorldPosition(new THREE.Vector3()).add(fwd.clone().multiplyScalar(0.5)).add(new THREE.Vector3(0.15, -0.15, 0)), end);
  burst(end, 0xffb454, 4);
  if (hit) {
    const ent = hit.object.userData.ent;
    if (ent && !ent.dead && (ent.kind === 'bot' || ent.kind === 'animal' || ent.kind === 'tree' || ent.kind === 'rock' || ent.kind === 'barrel' || ent.kind === 'crate' || ent.kind === 'radbarrel')) {
      let dmg = ent.kind === 'bot' ? 38 : 30;
      if (hit.point.y > (ent.pos.y + 1.5) && (ent.kind === 'bot')) dmg *= 2; // headshot
      damageEnt(ent, Math.round(dmg), hit.point, false);
      $('hitmark').classList.remove('show');
      void $('hitmark').offsetWidth;
      $('hitmark').classList.add('show');
    }
  }
}
function damageEnt(ent, dmg, point, isMelee) {
  ent.hp -= dmg;
  if (point) burst(point, ent.kind === 'bot' || ent.kind === 'animal' ? 0xff5a5a : 0xffd27a, 6);
  if (ent.kind === 'bot' && !ent.dead) {
    ent.state = 'chase'; // aggro
    if (ent.hp <= 0) killBot(ent);
    else { ent.mesh.position.x += rand(-0.2, 0.2); }
  } else if (ent.kind === 'animal' && !ent.dead) {
    if (ent.hp <= 0) killAnimal(ent);
    else { // flee
      const dx = ent.pos.x - player.pos.x, dz = ent.pos.z - player.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      ent.tx = ent.pos.x + dx / l * 20; ent.tz = ent.pos.z + dz / l * 20;
      if (ent.aggressive && Math.hypot(dx, dz) < 6) { /* boar fights */ ent.state = 'attack'; }
    }
  } else if ((ent.kind === 'tree' || ent.kind === 'rock' || ent.kind === 'barrel' || ent.kind === 'crate' || ent.kind === 'radbarrel')) {
    ent.mesh.rotation.z += rand(-0.03, 0.03);
    if (ent.hp <= 0) harvestNode(ent, isMelee);
  }
}
function gain(res, n) {
  S.inv[res] = (S.inv[res] || 0) + n;
  toast(`+${n} ${res}`);
  sfx('pickup');
}
function harvestNode(ent, isMelee) {
  const p = ent.pos.clone(); p.y += 1;
  burst(p, 0xffe08a, 10);
  sfx('pickup');
  if (ent.kind === 'tree') {
    const n = Math.round(rand(35, 55) * toolMult('tree'));
    S.inv.wood += n; toast(`🪵 +${n} wood`);
  } else if (ent.kind === 'rock') {
    const n = Math.round(rand(28, 45) * toolMult('rock'));
    S.inv.stone += n; toast(`🪨 +${n} stone`);
  } else if (ent.kind === 'barrel' || ent.kind === 'radbarrel') {
    const s = Math.round(rand(8, 22)); S.inv.scrap += s;
    if (Math.random() < 0.5) { const a = Math.round(rand(4, 12)); S.inv.ammo += a; toast(`🔸 +${a} ammo`); }
    if (Math.random() < 0.4) { S.inv.cloth += 8; toast(`🧵 +8 cloth`); }
    if (Math.random() < 0.35) { S.inv.meat += 1; toast(`🍖 +1 rations`); }
    toast(`⚙️ +${s} scrap`);
  } else if (ent.kind === 'crate') {
    const w = Math.round(rand(20, 60)); S.inv.wood += w;
    const sc = Math.round(rand(10, 30)); S.inv.scrap += sc;
    const a = Math.round(rand(6, 18)); S.inv.ammo += a;
    if (Math.random() < 0.5) { S.inv.medkit++; toast('💊 +1 bandage'); }
    toast(`📦 loot: +${w} wood, +${sc} scrap, +${a} ammo`);
    feed(`📦 You raided a crate at the monument`);
  }
  // remove
  scene.remove(ent.mesh);
  ent.mesh.traverse?.(o => { if (o.isMesh) { const i = shootables.indexOf(o); if (i >= 0) shootables.splice(i, 1); } });
  if (ent.mesh.isMesh) { const i = shootables.indexOf(ent.mesh); if (i >= 0) shootables.splice(i, 1); }
  let ci = colliders.findIndex(c => Math.abs(c.x - ent.pos.x) < 0.01 && Math.abs(c.z - ent.pos.z) < 0.01);
  if (ci >= 0) colliders.splice(ci, 1);
  const ni = nodes.indexOf(ent); if (ni >= 0) nodes.splice(ni, 1);
  respawnQueue.push({ kind: ent.kind === 'radbarrel' ? 'barrel' : ent.kind, t: rand(90, 150) });
  save();
}
function killBot(ent) {
  ent.dead = true;
  ent.mesh.rotation.x = -Math.PI / 2; // fall
  ent.mesh.position.y = groundH(ent.pos.x, ent.pos.z) + 0.4;
  burst(ent.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xff5a5a, 12);
  sfx('hurt');
  S.kills++;
  const a = Math.round(rand(10, 24)); S.inv.ammo += a;
  const sc = Math.round(rand(15, 35)); S.inv.scrap += sc;
  feed(`☠ You killed a scavenger <b>(+${a} ammo, +${sc} scrap)</b> — ${S.kills}/6`);
  toast(`☠ Scavenger down! +${a} ammo +${sc} scrap`);
  if (S.kills >= 6) { feed(`🏆 <b>ISLAND CLEARED!</b> All 6 scavengers dead.`); toast('🏆 ISLAND CLEARED!', 4000); }
  save();
}
function killAnimal(ent) {
  ent.dead = true;
  ent.mesh.rotation.z = Math.PI / 2;
  burst(ent.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), 0xff5a5a, 8);
  const m = ent.deer ? 2 : 3;
  S.inv.meat += m; toast(`🍖 +${m} meat — press F to eat`);
  sfx('pickup'); save();
}
function doInteract(forceHit = false) {
  if (S.mode !== 'playing') return;
  const hit = aimRay(3.6);
  if (hit && hit.object.userData.ent && !hit.object.userData.ent.dead) {
    const ent = hit.object.userData.ent;
    if (['tree', 'rock', 'barrel', 'crate', 'hemp', 'radbarrel'].includes(ent.kind)) { meleeHit(); return; }
    if (ent.kind === 'bot' || ent.kind === 'animal') { meleeHit(); return; }
  }
  if (forceHit) meleeHit();
}

// ---------- building ----------
function tryPlaceWall() {
  if ((S.inv.wood || 0) < 50) { toast('Need 50 wood per wall — chop trees 🌲'); sfx('rock'); return; }
  camera.getWorldDirection(fwd);
  const px = player.pos.x + fwd.x * 3, pz = player.pos.z + fwd.z * 3;
  if (Math.abs(px) > WORLD_R || Math.abs(pz) > WORLD_R) { toast('Too close to island edge'); return; }
  for (const c of colliders) {
    const dx = c.x - px, dz = c.z - pz;
    if (dx * dx + dz * dz < (c.r + 1.6) * (c.r + 1.6)) { toast('Blocked — pick a clear spot'); return; }
  }
  S.inv.wood -= 50;
  const m = new THREE.Mesh(G.wall, M.wall);
  const y = groundH(px, pz);
  m.position.set(px, y + 1.3, pz);
  m.rotation.y = S.buildRot;
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  const ent = { kind: 'wall', hp: 200, maxHp: 200, pos: new THREE.Vector3(px, y, pz), mesh: m, r: 1.6 };
  m.userData.ent = ent; shootables.push(m); walls.push(ent);
  colliders.push({ x: px, z: pz, r: 1.7, wall: ent });
  burst(new THREE.Vector3(px, y + 1.5, pz), 0x5ad97a, 8);
  sfx('build'); toast('🧱 Wall placed (−50 wood)');
  save();
}

// ---------- menu / lifecycle ----------
$('playBtn').onclick = () => startPlay();
$('respawnBtn').onclick = () => respawn();
$('howBtn').onclick = () => {
  const p = $('howPanel');
  p.style.display = p.style.display === 'none' ? 'block' : 'none';
};
$('wipeBtn').onclick = () => {
  localStorage.removeItem(SAVE_KEY);
  S.inv = { wood: 0, stone: 0, scrap: 0, cloth: 0, meat: 0, ammo: 0, medkit: 0 };
  S.owned = { rock: true, hatchet: false, pickaxe: false, rifle: false };
  S.kills = 0; S.deaths = 0; S.health = 100; S.hunger = 100;
  save(); renderHotbar(); toast('Save wiped');
};
$('muteBtn').onclick = (e) => {
  S.muted = !S.muted; setMuted(S.muted);
  e.target.textContent = S.muted ? '🔇 Sound: off' : '🔊 Sound: on';
  save();
};
$('sens').value = S.sens;
$('sens').oninput = (e) => { S.sens = +e.target.value; save(); };
$('quality').value = S.quality;
$('quality').onchange = (e) => { S.quality = e.target.value; applyQuality(); save(); };
if (S.muted) $('muteBtn').textContent = '🔇 Sound: off';

function startPlay() {
  $('menu').style.display = 'none';
  $('dead').style.display = 'none';
  $('hud').classList.add('on');
  if (IS_TOUCH) $('touch').classList.add('on');
  $('fade').style.opacity = '0';
  S.mode = 'playing';
  player.hp = S.health; player.hunger = S.hunger;
  renderHotbar(); updateViewmodel();
  if (!IS_TOUCH) canvas.requestPointerLock?.();
  toast('🌲 Chop trees • 🪨 mine rocks • 🛢 loot barrels', 3500);
  feed(`👋 Survive! ${6 - S.kills} scavengers roam the monument.`);
}
function die(cause) {
  if (S.mode !== 'playing') return;
  S.mode = 'dead'; S.deaths++;
  S.health = 100; S.hunger = 100;
  S.inv.wood = Math.floor(S.inv.wood / 2); S.inv.stone = Math.floor(S.inv.stone / 2);
  save();
  document.exitPointerLock?.();
  $('touch').classList.remove('on');
  $('deathCause').textContent = cause + ` — kills: ${S.kills}, deaths: ${S.deaths}`;
  $('dead').style.display = 'flex';
  sfx('hurt');
}
function respawn() {
  player.pos.copy(spawnPoint());
  player.vel.set(0, 0, 0);
  player.hp = 100; player.hunger = 100;
  player.yaw = Math.atan2(player.pos.x, player.pos.z); // face island center
  S.mode = 'playing';
  $('dead').style.display = 'none';
  $('hud').classList.add('on');
  if (IS_TOUCH) $('touch').classList.add('on');
  else canvas.requestPointerLock?.();
  toast('🪂 Respawned on the beach (kept tools, lost half loot)');
}

// ---------- collision ----------
function collide(px, pz, radius = 0.55) {
  for (const c of colliders) {
    const dx = px - c.x, dz = pz - c.z;
    const d2 = dx * dx + dz * dz, rr = c.r + radius;
    if (d2 < rr * rr && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      px = c.x + dx / d * rr; pz = c.z + dz / d * rr;
    }
  }
  const l = Math.hypot(px, pz);
  if (l > WORLD_R) { px *= WORLD_R / l; pz *= WORLD_R / l; }
  return [px, pz];
}

// ---------- enemy AI ----------
function updateBots(dt) {
  let alive = 0;
  for (const b of bots) {
    if (b.dead) continue;
    alive++;
    const dx = player.pos.x - b.pos.x, dz = player.pos.z - b.pos.z;
    const dist = Math.hypot(dx, dz);
    if (S.mode === 'playing' && dist < 30) b.state = 'chase';
    else if (dist > 45) b.state = 'wander';
    let mx = 0, mz = 0;
    if (b.state === 'chase' && S.mode === 'playing') {
      mx = dx / (dist || 1); mz = dz / (dist || 1);
      b.mesh.rotation.y = Math.atan2(mx, mz);
      if (dist < 26) { // shoot
        b.shootT -= dt;
        if (b.shootT <= 0) {
          b.shootT = rand(1.2, 2.2);
          const from = b.pos.clone(); from.y += 1.4;
          const to = player.pos.clone(); to.y += 1.2;
          to.x += rand(-1.2, 1.2); to.y += rand(-0.5, 0.5); to.z += rand(-1.2, 1.2);
          spawnTracer(from, to, 0xff6a5a);
          sfx('shot');
          const hitChance = THREE.MathUtils.clamp(0.55 - dist * 0.012, 0.08, 0.5);
          if (Math.random() < hitChance) hurtPlayer(Math.round(rand(7, 13)), 'Shot by a scavenger');
        }
      }
      if (dist < 2.2) { mx = mz = 0; }
    } else {
      // wander
      const wx = b.tx - b.pos.x, wz = b.tz - b.pos.z;
      const wd = Math.hypot(wx, wz);
      if (wd < 2) { b.tx = b.pos.x + rand(-30, 30); b.tz = b.pos.z + rand(-30, 30); }
      else { mx = wx / wd; mz = wz / wd; b.mesh.rotation.y = Math.atan2(mx, mz); }
    }
    const sp = b.state === 'chase' ? b.speed + 1.2 : b.speed * 0.5;
    let nx = b.pos.x + mx * sp * dt, nz = b.pos.z + mz * sp * dt;
    [nx, nz] = collide(nx, nz, 0.5);
    b.pos.x = nx; b.pos.z = nz;
    b.pos.y = groundH(nx, nz);
    b.mesh.position.y += Math.abs(Math.sin(performance.now() * 0.008)) * 0.002; // bob
    b.lamp.material.emissiveIntensity = b.state === 'chase' ? 3.5 : 1.5;
  }
  return alive;
}
function updateAnimals(dt) {
  for (const a of animals) {
    if (a.dead) continue;
    const dx = player.pos.x - a.pos.x, dz = player.pos.z - a.pos.z;
    const dist = Math.hypot(dx, dz);
    if (a.state === 'attack' && dist < 2.4 && S.mode === 'playing') {
      a.wait -= dt;
      if (a.wait <= 0) { a.wait = 1.1; hurtPlayer(Math.round(rand(5, 10)), 'Gored by a boar'); }
    }
    const wx = a.tx - a.pos.x, wz = a.tz - a.pos.z;
    const wd = Math.hypot(wx, wz);
    if (wd < 1.5) {
      a.wait -= dt;
      if (a.wait <= 0) {
        a.wait = rand(2, 6);
        a.tx = a.pos.x + rand(-40, 40); a.tz = a.pos.z + rand(-40, 40);
        if (a.state === 'attack' && dist > 12) a.state = 'wander';
      }
    } else {
      const sp = (a.state === 'attack' ? 4.2 : a.deer ? 2.0 : 1.4);
      let nx = a.pos.x + wx / wd * sp * dt, nz = a.pos.z + wz / wd * sp * dt;
      [nx, nz] = collide(nx, nz, 0.5);
      a.pos.x = nx; a.pos.z = nz;
      // body is built along +x (head at +x); face travel direction
      a.mesh.rotation.y = -Math.atan2(wz, wx);
    }
    a.pos.y = groundH(a.pos.x, a.pos.z);
  }
}
function hurtPlayer(dmg, cause) {
  if (S.mode !== 'playing') return;
  player.hp -= dmg;
  player.hurtT = 1;
  sfx('hurt');
  $('dmg').style.opacity = '1';
  setTimeout(() => $('dmg').style.opacity = '0', 180);
  if (player.hp <= 0) { player.hp = 0; die(cause); }
}

// ---------- day/night ----------
const skyDay = new THREE.Color(0x87b5d6), skyNight = new THREE.Color(0x070b16);
const skySet = new THREE.Color(0xe88a4a);
function updateSky() {
  const t = S.time % 1; // 0=midnight, 0.25=sunrise, 0.5=noon
  const ang = (t - 0.25) * Math.PI * 2;
  const elev = Math.sin(ang); // -1..1
  sun.position.set(Math.cos(ang) * 120, Math.max(elev, -0.2) * 140 + 10, 40);
  const day = THREE.MathUtils.clamp(elev * 1.6 + 0.25, 0, 1);
  const dusk = Math.exp(-Math.pow(elev * 4, 2));
  const sky = skyNight.clone().lerp(skyDay, day).lerp(skySet, dusk * 0.55 * day + dusk * 0.2);
  scene.background.copy(sky);
  scene.fog.color.copy(sky);
  sun.intensity = 0.08 + day * 1.7;
  hemi.intensity = 0.18 + day * 0.65;
  const hh = Math.floor(((t * 24) + 24) % 24), mm = Math.floor((((t * 24) % 1)) * 60);
  $('clock').textContent = `${elev > -0.05 ? '☀' : '🌙'} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ---------- HUD ----------
function updateHUD(alive, fps) {
  $('hp').firstElementChild.style.width = `${Math.max(0, player.hp)}%`;
  $('hp').lastElementChild.textContent = `${Math.ceil(Math.max(0, player.hp))} HP`;
  $('hunger').firstElementChild.style.width = `${Math.max(0, player.hunger)}%`;
  $('hunger').lastElementChild.textContent = `${Math.ceil(Math.max(0, player.hunger))} FOOD`;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const deg = ((-player.yaw * 180 / Math.PI) % 360 + 360) % 360;
  $('compass').textContent = dirs[Math.round(deg / 45) % 8] + ` ${Math.round(deg)}°`;
  $('alive').textContent = `• ${alive} bots • ${S.kills}☠`;
  $('fps').textContent = `${Math.round(fps)}fps`;
  // interact prompt
  const hit = S.mode === 'playing' ? aimRay(3.6) : null;
  const pr = $('prompt');
  if (hit?.object.userData.ent && !hit.object.userData.ent.dead) {
    const e = hit.object.userData.ent;
    const names = { tree: '🌲 Tree — chop', rock: '🪨 Rock — mine', barrel: '🛢 Barrel — loot', radbarrel: '☢ Barrel — loot (RAD!)', hemp: '🌿 Hemp — gather', crate: '📦 Crate — loot', bot: '⚠️ Scavenger', animal: e.deer ? '🦌 Deer' : '🐗 Boar' };
    pr.style.display = 'block';
    pr.textContent = IS_TOUCH ? `${names[e.kind] || ''} — tap HIT` : `${names[e.kind] || ''} — [LMB / E]`;
  } else if (HOTBAR[S.sel].id === 'plan') {
    pr.style.display = 'block';
    pr.textContent = IS_TOUCH ? '📐 Aim + FIRE to place wall (50 wood)' : '📐 Click to place wall (50 wood) • R rotates';
  } else pr.style.display = 'none';
  // ghost wall
  if (HOTBAR[S.sel].id === 'plan' && S.mode === 'playing') {
    camera.getWorldDirection(fwd);
    ghost.visible = true;
    ghost.position.set(player.pos.x + fwd.x * 3, player.pos.y + 1.2, player.pos.z + fwd.z * 3);
    ghost.rotation.y = S.buildRot;
    const ok = (S.inv.wood || 0) >= 50;
    ghost.material.color.setHex(ok ? 0x5ad97a : 0xff5a5a);
  } else ghost.visible = false;
}

// ---------- main loop ----------
const clock = new THREE.Clock();
let fpsA = 60, saveT = 0, menuA = 0;
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  fpsA += ((1 / Math.max(dt, 0.001)) - fpsA) * 0.05;
  S.time = (S.time + dt / DAY_LEN) % 1;

  if (S.mode === 'playing') {
    // --- movement ---
    let ix = 0, iz = 0;
    if (keys.KeyW || keys.ArrowUp) iz -= 1;
    if (keys.KeyS || keys.ArrowDown) iz += 1;
    if (keys.KeyA || keys.ArrowLeft) ix -= 1;
    if (keys.KeyD || keys.ArrowRight) ix += 1;
    ix += joy.x; iz += joy.y;
    const l = Math.hypot(ix, iz);
    if (l > 1) { ix /= l; iz /= l; }
    const sprint = keys.ShiftLeft || keys.ShiftRight || (IS_TOUCH && l > 0.92);
    const spd = sprint ? 7.4 : 4.8;
    // forward is (-sin(yaw), -cos(yaw)); right is (cos(yaw), -sin(yaw))
    const fX = -Math.sin(player.yaw), fZ = -Math.cos(player.yaw);
    const rX = Math.cos(player.yaw), rZ = -Math.sin(player.yaw);
    const vx = (fX * -iz + rX * ix) * spd;
    const vz = (fZ * -iz + rZ * ix) * spd;
    player.vel.x += (vx - player.vel.x) * Math.min(1, dt * 10);
    player.vel.z += (vz - player.vel.z) * Math.min(1, dt * 10);
    player.vel.y -= 22 * dt;
    if ((keys.Space) && player.onGround) { player.vel.y = 8; player.onGround = false; }
    let nx = player.pos.x + player.vel.x * dt;
    let nz = player.pos.z + player.vel.z * dt;
    [nx, nz] = collide(nx, nz, 0.55);
    player.pos.x = nx; player.pos.z = nz;
    let ny = player.pos.y + player.vel.y * dt;
    const gy = groundH(nx, nz);
    const inWater = gy < WATER_Y - 0.15;
    if (ny <= gy) { ny = gy; player.vel.y = 0; player.onGround = true; }
    else player.onGround = ny - gy < 0.05;
    player.pos.y = ny;

    // camera
    const bob = (Math.abs(player.vel.x) + Math.abs(player.vel.z) > 1 && player.onGround)
      ? Math.sin(performance.now() * 0.011) * 0.035 : 0;
    camera.position.set(player.pos.x, player.pos.y + 1.62 + bob, player.pos.z);
    camera.rotation.set(0, 0, 0);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw; camera.rotation.x = player.pitch;
    sun.target.position.copy(camera.position);

    // viewmodel swing
    player.swing = Math.max(0, player.swing - dt * 3);
    vm.position.set(0.42, -0.42 - player.swing * 0.08, -0.7);
    vm.rotation.x = -player.swing * 1.1;
    player.hitCd -= dt; player.shootCd -= dt;

    // --- survival ---
    player.hunger = Math.max(0, player.hunger - dt * (100 / 420));
    if (player.hunger <= 0) hurtPlayer(3 * dt, 'You starved');
    else if (player.hunger > 55 && player.hp < 100) player.hp = Math.min(100, player.hp + 1.4 * dt);
    const dc = Math.hypot(player.pos.x, player.pos.z);
    if (dc < 14) {
      player.radWarn += dt;
      hurtPlayer(3.5 * dt, 'Radiation at the monument');
      if (player.radWarn > 4) { player.radWarn = 0; toast('☢ RADIATION! Loot fast & leave!'); }
    }
    if (inWater && player.pos.y < WATER_Y + 0.2) hurtPlayer(4 * dt, 'You drowned');
    if (player.hurtT > 0) player.hurtT -= dt;
    S.health = player.hp; S.hunger = player.hunger;

    // respawns
    for (let i = respawnQueue.length - 1; i >= 0; i--) {
      respawnQueue[i].t -= dt;
      if (respawnQueue[i].t <= 0) {
        const k = respawnQueue[i].kind;
        respawnQueue.splice(i, 1);
        const x = rand(-105, 105), z = rand(-105, 105);
        if (groundH(x, z) < 1.2) continue;
        if (k === 'tree') makeTree(x, z);
        else if (k === 'rock') makeRockNode(x, z);
        else if (k === 'barrel') makeBarrel(x, z);
        else if (k === 'hemp') makeHemp(x, z);
        else if (k === 'crate') { if (Math.hypot(x, z) < 30) makeCrate(x, z); }
      }
    }
    saveT += dt;
    if (saveT > 10) { saveT = 0; save(); }
  } else {
    // menu orbit backdrop
    menuA += dt * 0.08;
    camera.position.set(Math.cos(menuA) * 70, 26, Math.sin(menuA) * 70);
    camera.lookAt(0, 2, 0);
    sun.target.position.set(0, 0, 0);
  }

  const alive = updateBots(S.mode === 'playing' ? dt : 0);
  if (S.mode === 'playing') updateAnimals(dt);
  else { for (const a of animals) { if (!a.dead) a.pos.y = groundH(a.pos.x, a.pos.z); } }

  // tracers / particles
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].life -= dt;
    tracers[i].mesh.material.opacity = Math.max(0, tracers[i].life * 8);
    if (tracers[i].life <= 0) {
      scene.remove(tracers[i].mesh);
      tracers[i].mesh.geometry.dispose(); tracers[i].mesh.material.dispose();
      tracers.splice(i, 1);
    }
  }
  for (const pt of parts) {
    if (pt.life <= 0) continue;
    pt.life -= dt;
    pt.vel.y -= 9 * dt;
    pt.mesh.position.addScaledVector(pt.vel, dt);
    if (pt.life <= 0) pt.mesh.visible = false;
  }

  updateSky();
  if (S.mode === 'playing') updateHUD(alive, fpsA);
  renderer.render(scene, camera);
}

renderHotbar();
updateViewmodel();
tick();
setTimeout(() => $('fade').style.opacity = '0', 300);

// expose for debugging / tests
window.__rustfall = { S, player, bots, nodes, startPlay, primaryAction, doInteract, eatFood, tryPlaceWall, craft };
