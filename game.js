(() => {
'use strict';

// ---------- Константы ----------
const T = 64;            // размер тайла, px
const W = 56, H = 56;    // карта в тайлах
const TAU = Math.PI * 2;
const TILE = { GRASS: 0, ROAD: 1, WALK: 2, BUILDING: 3, WATER: 4, LOT: 5, SAND: 6 };
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // E S W N
const COLORS = ['#b35c4a', '#8d7b68', '#5e6b7a', '#a3443f', '#6d8a62', '#7a6a9e', '#9f8a4f', '#4f6f8c', '#c08b6c', '#5a5a5a'];
const WEAPONS = {
  fist: { name: 'Кулаки', dmg: 15, rate: 0.4, range: 34, ammo: Infinity, melee: true },
  pistol: { name: 'Пистолет', dmg: 25, rate: 0.3, speed: 900, spread: 0.03 },
  uzi: { name: 'Узи', dmg: 12, rate: 0.07, speed: 850, spread: 0.1 },
  shotgun: { name: 'Дробовик', dmg: 14, rate: 0.8, speed: 800, spread: 0.18, pellets: 6 },
};
const CAR_TYPES = {
  sedan: { l: 46, w: 24, max: 300, accel: 260, hp: 100, colors: COLORS },
  sports: { l: 44, w: 22, max: 420, accel: 380, hp: 100, colors: ['#e53935', '#ffeb3b', '#1e88e5', '#fafafa', '#ff9800'] },
  truck: { l: 60, w: 28, max: 220, accel: 180, hp: 180, colors: ['#8d6e63', '#546e7a', '#37474f', '#6d4c41'] },
  taxi: { l: 46, w: 24, max: 300, accel: 260, hp: 100, colors: ['#ffc107'] },
  police: { l: 48, w: 24, max: 380, accel: 360, hp: 120, colors: ['#f5f5f5'] },
};

// ---------- DOM ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const mini = document.getElementById('minimap');
const mctx = mini.getContext('2d');
const el = id => document.getElementById(id);

function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
addEventListener('resize', resize); resize();

// ---------- Звук (синтез, без файлов) ----------
let actx = null, engineOsc = null, engineGain = null;
function audioInit() {
  if (actx) return;
  actx = new (window.AudioContext || window.webkitAudioContext)();
  engineOsc = actx.createOscillator(); engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 60;
  engineGain = actx.createGain(); engineGain.gain.value = 0;
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
  engineOsc.connect(lp).connect(engineGain).connect(actx.destination); engineOsc.start();
}
function noise(dur, vol, freq, type = 'lowpass') {
  if (!actx) return;
  const n = actx.sampleRate * dur, buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = actx.createBufferSource(); src.buffer = buf;
  const f = actx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = actx.createGain(); g.gain.value = vol;
  src.connect(f).connect(g).connect(actx.destination); src.start();
}
function beep(freq, dur, vol = 0.15) {
  if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.frequency.value = freq; o.type = 'square'; g.gain.value = vol;
  g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
  o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
}
const SFX = {
  shot: () => noise(0.12, 0.35, 1800, 'highpass'),
  shotgun: () => noise(0.25, 0.5, 900),
  punch: () => noise(0.08, 0.3, 300),
  boom: () => noise(0.9, 0.9, 250),
  crash: () => noise(0.2, 0.4, 500),
  pickup: () => { beep(880, 0.08); setTimeout(() => beep(1320, 0.12), 80); },
  cash: () => { beep(1200, 0.06, 0.1); setTimeout(() => beep(1600, 0.08, 0.1), 60); },
  done: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.18, 0.12), i * 110)),
  fail: () => [400, 300, 200].forEach((f, i) => setTimeout(() => beep(f, 0.25, 0.12), i * 160)),
};

// ---------- Утилиты ----------
const rnd = (a, b) => a + Math.random() * (b - a);
const rndi = (a, b) => Math.floor(rnd(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
const tx = px => Math.floor(px / T);

// ---------- Карта ----------
const map = new Uint8Array(W * H);
const buildings = [];   // {x,y,w,h,floors,color}
const trees = [];       // {x,y,r}
const parkedSpots = []; // {x,y,a}
const isRoadIdx = i => i >= 2 && i < 52 && ((i - 2) % 8) < 2;
const tileAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? TILE.WATER : map[y * W + x];
const setTile = (x, y, t) => { map[y * W + x] = t; };
const solidTile = t => t === TILE.BUILDING || t === TILE.WATER;
function solidAt(px, py) {
  if (solidTile(tileAt(tx(px), tx(py)))) return true;
  for (const t of trees) if ((px - t.x) ** 2 + (py - t.y) ** 2 < (t.r + 4) ** 2) return true;
  return false;
}
const walkable = t => t === TILE.WALK || t === TILE.GRASS || t === TILE.LOT || t === TILE.SAND;

function generateMap() {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let t;
    if (x < 2 || y < 2 || x >= 54 || y >= 54) t = TILE.WATER;
    else if (isRoadIdx(x) || isRoadIdx(y)) t = TILE.ROAD;
    else if (x >= 52 || y >= 52) t = TILE.SAND;
    else t = TILE.WALK;
    setTile(x, y, t);
  }
  for (let bi = 0; bi < 6; bi++) for (let bj = 0; bj < 6; bj++) {
    const x0 = 5 + bi * 8, y0 = 5 + bj * 8; // внутренняя область 4x4
    const r = Math.random();
    const kind = (bi === 2 && bj === 2) ? 'park' : r < 0.18 ? 'park' : r < 0.3 ? 'lot' : 'buildings';
    if (kind === 'park') {
      for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) setTile(x, y, TILE.GRASS);
      for (let i = 0; i < 7; i++) trees.push({ x: (x0 + rnd(0.3, 3.7)) * T, y: (y0 + rnd(0.3, 3.7)) * T, r: rnd(10, 16) });
    } else if (kind === 'lot') {
      for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) setTile(x, y, TILE.LOT);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++)
        parkedSpots.push({ x: (x0 + 0.5 + i) * T, y: (y0 + 1 + j * 2) * T, a: Math.PI / 2 });
    } else {
      const layouts = [
        [[0, 0, 4, 4]], [[0, 0, 4, 2], [0, 2, 4, 2]], [[0, 0, 2, 4], [2, 0, 2, 4]],
        [[0, 0, 2, 2], [2, 0, 2, 2], [0, 2, 2, 2], [2, 2, 2, 2]], [[0, 0, 2, 2], [2, 0, 2, 2], [0, 2, 4, 2]],
        [[0, 0, 4, 2], [0, 2, 2, 2], [2, 2, 2, 2]],
      ];
      for (const [ox, oy, w, h] of pick(layouts)) {
        for (let y = y0 + oy; y < y0 + oy + h; y++) for (let x = x0 + ox; x < x0 + ox + w; x++) setTile(x, y, TILE.BUILDING);
        const big = w * h >= 8;
        buildings.push({ x: (x0 + ox) * T + 3, y: (y0 + oy) * T + 3, w: w * T - 6, h: h * T - 6, floors: big ? rndi(3, 9) : rndi(1, 5), color: pick(COLORS) });
      }
    }
  }
  // кусты/деревья на тротуарах
  for (let i = 0; i < 90; i++) {
    const x = rndi(4, 51), y = rndi(4, 51);
    if (tileAt(x, y) === TILE.WALK && !isRoadIdx(x + 1) && !isRoadIdx(x - 1) && !isRoadIdx(y + 1) && !isRoadIdx(y - 1))
      trees.push({ x: (x + 0.5) * T, y: (y + 0.5) * T, r: 9 });
  }
}

// Центр полосы для направления движения (правостороннее движение)
function laneCoord(dir, roadStart) {
  // roadStart — индекс первого из двух тайлов дороги
  return (dir === 0 || dir === 1) ? (roadStart + 1) * T + T / 2 : roadStart * T + T / 2;
}
const roadStartIdx = i => i - ((i - 2) % 8);

// ---------- Состояние игры ----------
const keys = {};
const mouse = { x: 0, y: 0, down: false };
const cam = { x: 0, y: 0, zoom: 1 };
let cars = [], peds = [], bullets = [], parts = [], pickups = [], blips = [];
let player, wanted = 0, heat = 0, money = 0, time = 0, running = false, shake = 0;
let mission = null, missionIdx = 0, kills = 0;
let toastTimer = 0;
const missionQueue = ['steal', 'courier', 'gang', 'taxi'];

function toast(txt, t = 2.5) { el('toast').textContent = txt; el('toast').classList.add('show'); toastTimer = t; }

// ---------- Сущности ----------
function makeCar(x, y, a, type = pick(['sedan', 'sedan', 'sedan', 'sports', 'truck', 'taxi'])) {
  const ct = CAR_TYPES[type];
  return { x, y, a, v: 0, type, l: ct.l, w: ct.w, color: pick(ct.colors), hp: ct.hp, maxHp: ct.hp, ai: false, dir: 0, decided: false, turnDir: 0, driver: null, dead: false, fire: 0, stuck: 0, siren: 0 };
}
function makePed(x, y, kind = 'civ') {
  const skins = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
  const shirts = kind === 'cop' ? ['#1a3f8f'] : kind === 'gang' ? ['#b71c1c', '#7f0000'] : ['#e91e63', '#9c27b0', '#2196f3', '#4caf50', '#ff9800', '#795548', '#607d8b', '#fff'];
  return { x, y, a: rnd(0, TAU), kind, hp: kind === 'civ' ? 40 : 60, state: kind === 'civ' ? 'walk' : 'guard', skin: pick(skins), shirt: pick(shirts), target: null, timer: rnd(0, 2), speed: rnd(40, 65), dead: 0, shootT: 0, inCar: null, passenger: false };
}
function makePlayer(x, y) {
  return { x, y, a: 0, hp: 100, car: null, weapon: 'pistol', weapons: { fist: Infinity, pistol: 60 }, shootT: 0, punchT: 0, r: 10 };
}

function spawnTrafficCar(nearX, nearY, minD = 700, maxD = 1200) {
  for (let i = 0; i < 20; i++) {
    const a = rnd(0, TAU), d = rnd(minD, maxD);
    const px = nearX + Math.cos(a) * d, py = nearY + Math.sin(a) * d;
    const ix = tx(px), iy = tx(py);
    if (tileAt(ix, iy) !== TILE.ROAD || (isRoadIdx(ix) && isRoadIdx(iy))) continue;
    const horiz = isRoadIdx(iy);
    const dir = horiz ? pick([0, 2]) : pick([1, 3]);
    const c = horiz ? { x: px, y: laneCoord(dir, roadStartIdx(iy)) } : { x: laneCoord(dir, roadStartIdx(ix)), y: py };
    if (cars.some(o => dist(o, c) < 90)) continue;
    const car = makeCar(c.x, c.y, dir * Math.PI / 2);
    car.ai = true; car.dir = dir; car.v = 0; car.driver = 'npc';
    cars.push(car); return car;
  }
}
function spawnPed(nearX, nearY, minD = 400, maxD = 900, kind = 'civ') {
  for (let i = 0; i < 20; i++) {
    const a = rnd(0, TAU), d = rnd(minD, maxD);
    const px = nearX + Math.cos(a) * d, py = nearY + Math.sin(a) * d;
    if (!walkable(tileAt(tx(px), tx(py)))) continue;
    const p = makePed(px, py, kind); peds.push(p); return p;
  }
}
function spawnPickup(kind, x, y) {
  if (x === undefined) {
    for (let i = 0; i < 50; i++) {
      const ix = rndi(4, 51), iy = rndi(4, 51);
      if (walkable(tileAt(ix, iy))) { x = (ix + 0.5) * T; y = (iy + 0.5) * T; break; }
    }
    if (x === undefined) return;
  }
  pickups.push({ x, y, kind, t: rnd(0, TAU) });
}

// ---------- Инициализация мира ----------
function newGame() {
  cars = []; peds = []; bullets = []; parts = []; pickups = []; blips = [];
  wanted = 0; heat = 0; money = 0; time = 0; mission = null; missionIdx = 0; kills = 0;
  player = makePlayer(T * 4.5 + T * 16, T * 4.5 + T * 16); // тротуар у центрального парка
  for (const s of parkedSpots) if (Math.random() < 0.7) { const c = makeCar(s.x, s.y, s.a); cars.push(c); }
  for (let i = 0; i < 40; i++) spawnTrafficCar(player.x, player.y, 200, 1800);
  for (let i = 0; i < 70; i++) spawnPed(player.x, player.y, 100, 1800);
  for (let i = 0; i < 14; i++) spawnPickup('money');
  for (let i = 0; i < 5; i++) spawnPickup('health');
  for (let i = 0; i < 3; i++) spawnPickup('uzi');
  for (let i = 0; i < 3; i++) spawnPickup('shotgun');
  for (let i = 0; i < 3; i++) spawnPickup('pistol');
  const c = makeCar(player.x + 100, player.y - 40, 0, 'sports'); cars.push(c);
  updateHud();
  toast('Нажми M, чтобы взять задание', 4);
}

// ---------- Ввод ----------
addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (keys[e.code]) return;
  keys[e.code] = true;
  if (!running) return;
  if (e.code === 'KeyE' || e.code === 'Enter') toggleCar();
  if (e.code === 'KeyQ') cycleWeapon();
  if (e.code === 'KeyM') missionKey();
  if (e.code === 'KeyF') tryShoot();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.down = false; });
canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener('mousedown', e => { if (e.button === 0) { mouse.down = true; tryShoot(); } });
addEventListener('mouseup', () => { mouse.down = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
el('start').onclick = () => { audioInit(); el('menu').classList.add('hidden'); newGame(); running = true; };
el('respawn').onclick = () => { el('wasted').classList.add('hidden'); respawn(); };

const worldMouse = () => ({ x: (mouse.x - canvas.width / 2) / cam.zoom + cam.x, y: (mouse.y - canvas.height / 2) / cam.zoom + cam.y });

// ---------- Оружие ----------
function cycleWeapon() {
  const list = Object.keys(player.weapons).filter(w => player.weapons[w] > 0);
  player.weapon = list[(list.indexOf(player.weapon) + 1) % list.length];
  updateHud();
}
function tryShoot() {
  if (!running || player.hp <= 0) return;
  const w = WEAPONS[player.weapon];
  if (player.shootT > 0) return;
  if (player.car && w.melee) return;
  const m = worldMouse();
  const a = angTo(player, m);
  player.shootT = w.rate;
  if (w.melee) {
    SFX.punch(); player.punchT = 0.15;
    for (const p of peds) if (!p.dead && !p.inCar && dist(p, player) < w.range + 10 && Math.abs(angDiff(a, angTo(player, p))) < 1) hurtPed(p, w.dmg, 'player');
    heat = Math.max(heat, 0.3);
    return;
  }
  if (player.weapons[player.weapon] <= 0) { cycleWeapon(); return; }
  player.weapons[player.weapon]--;
  (w.pellets ? SFX.shotgun : SFX.shot)();
  for (let i = 0; i < (w.pellets || 1); i++) fireBullet(player.x, player.y, a + rnd(-w.spread, w.spread), w, 'player');
  alarmNear(player.x, player.y, 450);
  shake = Math.max(shake, 2);
  updateHud();
}
function fireBullet(x, y, a, w, owner) {
  bullets.push({ x: x + Math.cos(a) * 14, y: y + Math.sin(a) * 14, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, dmg: w.dmg, life: 0.7, owner });
}
function alarmNear(x, y, r) {
  let witnesses = 0;
  for (const p of peds) if (!p.dead && p.kind === 'civ' && dist(p, { x, y }) < r) { p.state = 'flee'; p.timer = rnd(2, 4); p.fleeFrom = { x, y }; witnesses++; }
  const cop = peds.some(p => !p.dead && p.kind === 'cop' && dist(p, { x, y }) < r) || cars.some(c => c.type === 'police' && c.driver === 'npc' && dist(c, { x, y }) < r + 200);
  if (cop) addWanted(1);
  else if (wanted === 0 && witnesses > 0 && Math.random() < 0.08) { addWanted(1); toast('Кто-то вызвал полицию'); }
}

// ---------- Машины ----------
function toggleCar() {
  if (player.car) {
    const c = player.car; c.driver = null; player.car = null;
    const side = c.a + Math.PI / 2;
    player.x = c.x + Math.cos(side) * (c.w / 2 + 14); player.y = c.y + Math.sin(side) * (c.w / 2 + 14);
    if (solidAt(player.x, player.y)) { player.x = c.x - Math.cos(side) * (c.w / 2 + 14); player.y = c.y - Math.sin(side) * (c.w / 2 + 14); }
    if (c.type === 'police') { c.siren = 0; }
    if (mission && mission.type === 'taxi' && mission.stage === 1 && mission.passenger) { toast('Пассажир ждёт в машине!'); }
    return;
  }
  let best = null, bd = 60;
  for (const c of cars) { if (c.dead) continue; const d = dist(c, player); if (d < bd) { bd = d; best = c; } }
  if (!best) return;
  if (best.driver === 'npc') {
    // водитель выбегает
    const p = makePed(best.x + Math.cos(best.a + Math.PI / 2) * 30, best.y + Math.sin(best.a + Math.PI / 2) * 30);
    p.state = 'flee'; p.timer = 4; p.fleeFrom = { x: best.x, y: best.y }; peds.push(p);
    if (best.type === 'police') addWanted(2); else alarmNear(best.x, best.y, 350);
  }
  best.driver = 'player'; best.ai = false; best.decided = false; player.car = best;
  if (actx && actx.state === 'suspended') actx.resume();
}
function damageCar(c, d, by) {
  if (c.dead) return;
  c.hp -= d;
  if (c.hp <= 0) explodeCar(c, by);
}
function explodeCar(c, by) {
  c.dead = true; c.fire = 12; c.v = 0; c.ai = false;
  SFX.boom(); shake = Math.max(shake, 14);
  for (let i = 0; i < 40; i++) parts.push({ x: c.x, y: c.y, vx: rnd(-220, 220), vy: rnd(-220, 220), life: rnd(0.4, 1.2), c: pick(['#ff9800', '#ff5722', '#ffeb3b', '#333']), r: rnd(3, 8) });
  if (c.driver === 'player') { hurtPlayer(70, 'взрыв'); }
  if (c.driver === 'npc') c.driver = null;
  for (const p of peds) if (!p.dead && dist(p, c) < 80) hurtPed(p, 100, by);
  for (const o of cars) if (o !== c && !o.dead && dist(o, c) < 90) damageCar(o, 60, by);
  if (player.car !== c && dist(player, c) < 80) hurtPlayer(60, 'взрыв');
  if (by === 'player' && c.driver !== 'player') { addWanted(1); if (c.type === 'police') addWanted(1); }
}

function updatePlayerCar(c, dt) {
  const ct = CAR_TYPES[c.type];
  const fwd = keys.KeyW || keys.ArrowUp, back = keys.KeyS || keys.ArrowDown;
  const left = keys.KeyA || keys.ArrowLeft, right = keys.KeyD || keys.ArrowRight;
  const hb = keys.Space;
  if (fwd) c.v += ct.accel * dt;
  if (back) c.v -= (c.v > 0 ? ct.accel * 1.6 : ct.accel * 0.5) * dt;
  c.v = clamp(c.v, -ct.max * 0.4, ct.max);
  const drag = hb ? 2.2 : (fwd || back ? 0.25 : 0.9);
  c.v -= c.v * drag * dt;
  if (Math.abs(c.v) < 3 && !fwd && !back) c.v = 0;
  const steer = (left ? -1 : 0) + (right ? 1 : 0);
  const sf = clamp(Math.abs(c.v) / 120, 0, 1) * (hb ? 1.5 : 1);
  c.a += steer * 2.6 * sf * dt * Math.sign(c.v || 1);
  if (engineGain) { engineGain.gain.value = 0.05 + Math.abs(c.v) / ct.max * 0.08; engineOsc.frequency.value = 50 + Math.abs(c.v) / ct.max * 140 + (fwd ? 20 : 0); }
  moveCar(c, dt, 'player');
}

function moveCar(c, dt, who) {
  const nx = c.x + Math.cos(c.a) * c.v * dt, ny = c.y + Math.sin(c.a) * c.v * dt;
  // проверка углов кузова
  const hit = carHitsSolid(nx, ny, c.a, c.l, c.w);
  if (hit) {
    const impact = Math.abs(c.v);
    if (impact > 80) { SFX.crash(); damageCar(c, impact / 14, who); shake = Math.max(shake, impact / 60); if (who === 'player' && impact > 220) hurtPlayer(impact / 30, 'ДТП'); }
    c.v *= -0.35;
    // проталкиваемся в сторону, если застряли
    const ox = c.x - nx, oy = c.y - ny;
    c.x += ox * 0.5; c.y += oy * 0.5;
    return;
  }
  c.x = nx; c.y = ny;
  // столкновение с другими машинами
  for (const o of cars) {
    if (o === c) continue;
    const d = dist(c, o), minD = (c.l + o.l) / 4 + 14;
    if (d < minD && d > 0.01) {
      const a = angTo(o, c), push = (minD - d);
      c.x += Math.cos(a) * push * 0.6; c.y += Math.sin(a) * push * 0.6;
      if (!o.dead) { o.x -= Math.cos(a) * push * 0.4; o.y -= Math.sin(a) * push * 0.4; }
      const rel = Math.abs(c.v - (o.v || 0) * Math.cos(c.a - o.a));
      if (rel > 90) {
        SFX.crash(); shake = Math.max(shake, rel / 80);
        damageCar(c, rel / 12, who); damageCar(o, rel / 10, who);
        if (o.ai) { o.stuck = 1.5; o.v *= 0.3; }
        if (o.driver === 'player') hurtPlayer(rel / 40, 'ДТП');
        if (o.driver === 'npc' && o.type !== 'police') alarmNear(o.x, o.y, 300);
      }
      c.v *= 0.6;
      o.v *= 0.8;
    }
  }
  // сбить пешехода
  for (const p of peds) {
    if (p.dead || p.inCar) continue;
    if (dist(p, c) < c.l / 2 + 6 && Math.abs(c.v) > 40) {
      hurtPed(p, Math.abs(c.v) / 2, who);
      p.x += Math.cos(c.a) * 20 * Math.sign(c.v); p.y += Math.sin(c.a) * 20 * Math.sign(c.v);
      c.v *= 0.85;
    }
  }
  // сбить игрока
  if (who !== 'player' && !player.car && dist(player, c) < c.l / 2 + 8 && Math.abs(c.v) > 50) {
    hurtPlayer(Math.abs(c.v) / 5, 'наезд');
    player.x += Math.cos(c.a) * 30 * Math.sign(c.v); player.y += Math.sin(c.a) * 30 * Math.sign(c.v);
    c.v *= 0.7;
  }
}
function carHitsSolid(x, y, a, l, w) {
  const ca = Math.cos(a), sa = Math.sin(a);
  for (const [fx, fy] of [[l / 2, w / 2], [l / 2, -w / 2], [-l / 2, w / 2], [-l / 2, -w / 2], [l / 2, 0], [-l / 2, 0]]) {
    if (solidAt(x + fx * ca - fy * sa, y + fx * sa + fy * ca)) return true;
  }
  return false;
}

function updateAiCar(c, dt) {
  const ix = tx(c.x), iy = tx(c.y);
  if (c.stuck > 0) { c.stuck -= dt; c.v -= c.v * 2 * dt; return; }
  if (tileAt(ix, iy) !== TILE.ROAD) {
    // слетели с дороги — удалить вне экрана, либо тихо вернуть на полосу
    if (dist(c, player) > 900) { c.dead = true; c.remove = true; }
    c.v -= c.v * 2 * dt;
    return;
  }
  // перекрёсток
  const atX = isRoadIdx(ix) && isRoadIdx(iy);
  if (atX && !c.decided) {
    c.decided = true;
    const rsx = roadStartIdx(ix), rsy = roadStartIdx(iy);
    const opts = [];
    for (let d = 0; d < 4; d++) {
      if (d === (c.dir + 2) % 4) continue;
      const ex = rsx + DIRS[d][0] * 3, ey = rsy + DIRS[d][1] * 3;
      if (tileAt(ex, ey) === TILE.ROAD) opts.push(d);
    }
    const straight = opts.includes(c.dir) && Math.random() < 0.5 ? c.dir : pick(opts);
    c.turnDir = straight ?? (c.dir + 2) % 4;
    c.turnX = rsx; c.turnY = rsy;
  }
  if (!atX) c.decided = false;
  if (c.decided && c.turnDir !== c.dir) {
    const d = c.turnDir;
    // целевая координата полосы для нового направления
    if (d === 1 || d === 3) { // поворот на вертикаль — ждём нужный x
      const target = laneCoord(d, c.turnX);
      if ((c.dir === 0 && c.x >= target) || (c.dir === 2 && c.x <= target)) { c.x = target; c.dir = d; c.a = d * Math.PI / 2; }
    } else {
      const target = laneCoord(d, c.turnY);
      if ((c.dir === 1 && c.y >= target) || (c.dir === 3 && c.y <= target)) { c.y = target; c.dir = d; c.a = d * Math.PI / 2; }
    }
  }
  // разворот, если дорога кончилась
  if (c.decided && c.turnDir === (c.dir + 2) % 4) { c.dir = c.turnDir; c.a = c.dir * Math.PI / 2; c.turnDir = c.dir; }
  // подровнять по полосе (при объезде препятствия — по встречной)
  const horiz = c.dir === 0 || c.dir === 2;
  if (c.shiftT > 0) c.shiftT -= dt;
  const laneDir = c.shiftT > 0 ? (c.dir + 2) % 4 : c.dir;
  const laneTarget = horiz ? laneCoord(laneDir, roadStartIdx(iy)) : laneCoord(laneDir, roadStartIdx(ix));
  if (horiz) c.y += (laneTarget - c.y) * clamp(dt * 4, 0, 1); else c.x += (laneTarget - c.x) * clamp(dt * 4, 0, 1);
  c.a = c.dir * Math.PI / 2;
  // не врезаться в то, что впереди
  let want = c.type === 'sports' ? 190 : c.type === 'truck' ? 110 : 150;
  const fx = Math.cos(c.a), fy = Math.sin(c.a);
  const ahead = (o, len) => { const dx = o.x - c.x, dy = o.y - c.y; const f = dx * fx + dy * fy, s = Math.abs(-dx * fy + dy * fx); return f > 0 && f < len && s < 26; };
  let obstacle = false;
  for (const o of cars) if (o !== c && ahead(o, 95)) {
    want = Math.min(want, Math.max(0, (o.v || 0) * Math.cos(o.a - c.a) - 10));
    if (o.dead || o.driver === null || (o.ai && o.stuck > 0)) obstacle = true;
  }
  // стоим перед брошенной/сгоревшей машиной — объезжаем по встречной
  if (obstacle && !atX && c.shiftT <= 0) { c.blockT = (c.blockT || 0) + dt; if (c.blockT > 2) { c.shiftT = 3; c.blockT = 0; } } else c.blockT = 0;
  for (const p of peds) if (!p.dead && !p.inCar && ahead(p, 70)) want = 0;
  if (!player.car && ahead(player, 80)) want = 0;
  // помеха справа перед перекрёстком (с таймаутом против взаимной блокировки)
  const nx = tx(c.x + fx * 40), ny = tx(c.y + fy * 40);
  if (!atX && isRoadIdx(nx) && isRoadIdx(ny) && (c.waitT || 0) < 3) {
    const rightDir = (c.dir + 3) % 4;
    const blocked = cars.some(o => o !== c && !o.dead && o.dir === rightDir && (o.ai || o.police) && dist(o, c) < 150 && Math.abs(o.v) > 20 && ((o.x - c.x) * fx + (o.y - c.y) * fy) > -10);
    if (blocked) { want = 0; c.waitT = (c.waitT || 0) + dt; }
  } else if (atX) c.waitT = 0;
  c.v += clamp(want - c.v, -300 * dt, 150 * dt);
  moveCar(c, dt, 'npc');
}

function updatePoliceCar(c, dt) {
  const ct = CAR_TYPES[c.type];
  c.siren += dt;
  const target = player.car || player;
  const d = dist(c, target);
  const wantA = angTo(c, target);
  let diff = angDiff(c.a, wantA);
  if (c.stuck > 0) { c.stuck -= dt; c.v -= (c.v + 120) * dt * 2; c.a += 1.5 * dt * Math.sign(diff); moveCar(c, dt, 'npc'); return; }
  const onFoot = !player.car;
  let targetV = ct.max * 0.85;
  if (onFoot) {
    targetV = clamp((d - 120) * 2.2, 0, targetV);
    if (d < 200 && Math.abs(c.v) < 40 && !c.copOut) { // высаживаем копа
      c.copOut = true; c.driver = null; c.ai = false;
      const p = makePed(c.x + Math.cos(c.a + Math.PI / 2) * 28, c.y + Math.sin(c.a + Math.PI / 2) * 28, 'cop');
      p.state = 'chase'; peds.push(p);
    }
  }
  c.a += clamp(diff, -1, 1) * 2.4 * clamp(Math.abs(c.v) / 100, 0.3, 1) * dt;
  if (Math.abs(diff) > 2 && d < 200) targetV = -80;
  c.v += clamp(targetV - c.v, -400 * dt, ct.accel * dt);
  const px = c.x, py = c.y;
  moveCar(c, dt, 'npc');
  if (Math.abs(c.x - px) + Math.abs(c.y - py) < 0.3 && Math.abs(targetV) > 50) { c.stuckT = (c.stuckT || 0) + dt; if (c.stuckT > 0.6) { c.stuck = 1.2; c.stuckT = 0; } } else c.stuckT = 0;
}

// ---------- Пешеходы ----------
function hurtPed(p, dmg, by) {
  if (p.dead) return;
  p.hp -= dmg;
  for (let i = 0; i < 4; i++) parts.push({ x: p.x, y: p.y, vx: rnd(-80, 80), vy: rnd(-80, 80), life: rnd(0.2, 0.5), c: '#c62828', r: 2.5 });
  if (p.state === 'walk') { p.state = 'flee'; p.timer = 3; p.fleeFrom = { x: player.x, y: player.y }; }
  if (p.hp <= 0) {
    p.dead = 15;
    if (by === 'player') {
      kills++;
      if (p.kind === 'cop') { addWanted(2); } else if (p.kind === 'civ') { addWanted(1); if (Math.random() < 0.7) spawnPickup('money', p.x + rnd(-10, 10), p.y + rnd(-10, 10)); }
      else if (p.kind === 'gang' && Math.random() < 0.5) spawnPickup('money', p.x, p.y);
    }
    if (p.passenger && mission && mission.type === 'taxi') failMission('Пассажир погиб');
  }
}
function pedTryMove(p, dx, dy) {
  const nx = p.x + dx, ny = p.y + dy;
  const ok = (x, y) => !solidAt(x, y) && !cars.some(c => !c.dead && Math.abs(c.x - x) < c.l / 2 + 6 && Math.abs(c.y - y) < c.l / 2 + 6 && pointInCar(x, y, c));
  if (ok(nx, ny)) { p.x = nx; p.y = ny; return true; }
  if (ok(nx, p.y)) { p.x = nx; return true; }
  if (ok(p.x, ny)) { p.y = ny; return true; }
  return false;
}
function pointInCar(x, y, c) {
  const dx = x - c.x, dy = y - c.y, ca = Math.cos(-c.a), sa = Math.sin(-c.a);
  const lx = dx * ca - dy * sa, ly = dx * sa + dy * ca;
  return Math.abs(lx) < c.l / 2 + 4 && Math.abs(ly) < c.w / 2 + 4;
}
function updatePed(p, dt) {
  if (p.dead) { p.dead -= dt; if (p.dead <= 0) p.remove = true; return; }
  if (p.inCar) { p.x = p.inCar.x; p.y = p.inCar.y; return; }
  p.timer -= dt;
  if (p.state === 'walk') {
    if (!p.target || dist(p, p.target) < 6) {
      const ix = tx(p.x), iy = tx(p.y);
      const opts = DIRS.map(([dx, dy]) => ({ x: ix + dx, y: iy + dy })).filter(t => walkable(tileAt(t.x, t.y)) || (tileAt(t.x, t.y) === TILE.ROAD && Math.random() < 0.08));
      if (!opts.length) { p.target = null; return; }
      const t = pick(opts); p.target = { x: (t.x + 0.5) * T, y: (t.y + 0.5) * T };
    }
    const a = angTo(p, p.target); p.a = a;
    if (!pedTryMove(p, Math.cos(a) * p.speed * dt, Math.sin(a) * p.speed * dt)) p.target = null;
    if (dist(p, player) < 25 && !player.car) { const a2 = angTo(player, p); pedTryMove(p, Math.cos(a2) * 40 * dt, Math.sin(a2) * 40 * dt); }
  } else if (p.state === 'flee') {
    const from = p.fleeFrom || player;
    if (p.timer <= 0) { p.state = 'walk'; p.target = null; return; }
    const a = angTo(from, p) + Math.sin(time * 3 + p.speed) * 0.5; p.a = a;
    if (!pedTryMove(p, Math.cos(a) * 130 * dt, Math.sin(a) * 130 * dt)) { p.fleeFrom = { x: p.x + rnd(-50, 50), y: p.y + rnd(-50, 50) }; }
  } else if (p.state === 'guard') {
    if (dist(p, player) < 380 && player.hp > 0) p.state = 'chase';
  } else if (p.state === 'chase') {
    const target = player.car || player;
    const d = dist(p, target);
    p.a = angTo(p, target);
    const keep = p.kind === 'gang' ? 170 : 130;
    if (d > keep) pedTryMove(p, Math.cos(p.a) * 95 * dt, Math.sin(p.a) * 95 * dt);
    else if (d < 70) pedTryMove(p, -Math.cos(p.a) * 60 * dt, -Math.sin(p.a) * 60 * dt);
    p.shootT -= dt;
    if (d < 300 && p.shootT <= 0 && player.hp > 0) {
      p.shootT = p.kind === 'cop' ? rnd(0.7, 1.1) : rnd(0.4, 0.8);
      SFX.shot();
      fireBullet(p.x, p.y, p.a + rnd(-0.12, 0.12), { dmg: p.kind === 'cop' ? 7 : 9, speed: 700 }, p.kind);
    }
    if (p.kind === 'cop' && wanted === 0) { p.state = 'walk'; p.kind = 'civ'; }
  }
}

// ---------- Игрок ----------
function hurtPlayer(d, cause) {
  if (player.hp <= 0) return;
  player.hp -= d; shake = Math.max(shake, 3);
  for (let i = 0; i < 3; i++) parts.push({ x: player.x, y: player.y, vx: rnd(-60, 60), vy: rnd(-60, 60), life: 0.4, c: '#c62828', r: 2.5 });
  if (player.hp <= 0) { player.hp = 0; die(cause); }
  updateHud();
}
function die(cause) {
  running = false;
  if (engineGain) engineGain.gain.value = 0;
  SFX.fail();
  el('wasted-text').textContent = `Причина: ${cause}. Лечение стоило $${Math.min(money, 500)}.`;
  setTimeout(() => el('wasted').classList.remove('hidden'), 1200);
}
function respawn() {
  money = Math.max(0, money - Math.min(money, 500));
  if (player.car) { player.car.driver = null; player.car = null; }
  player.hp = 100; player.x = T * 20.5; player.y = T * 4.5;
  wanted = 0; heat = 0;
  if (mission) failMission('Ты погиб');
  for (const p of peds) if (p.kind === 'cop') p.remove = true;
  for (const c of cars) if (c.type === 'police') c.remove = true;
  running = true; updateHud();
}
function updatePlayer(dt) {
  if (player.shootT > 0) player.shootT -= dt;
  if (player.punchT > 0) player.punchT -= dt;
  if (player.car) {
    if (player.car.dead) { player.car.driver = null; player.car = null; }
    else { updatePlayerCar(player.car, dt); player.x = player.car.x; player.y = player.car.y; player.a = player.car.a; }
  } else {
    if (engineGain) engineGain.gain.value = 0;
    let dx = 0, dy = 0;
    if (keys.KeyW || keys.ArrowUp) dy -= 1; if (keys.KeyS || keys.ArrowDown) dy += 1;
    if (keys.KeyA || keys.ArrowLeft) dx -= 1; if (keys.KeyD || keys.ArrowRight) dx += 1;
    const m = worldMouse(); player.a = angTo(player, m);
    if (dx || dy) {
      const l = Math.hypot(dx, dy), sp = 150;
      const nx = player.x + dx / l * sp * dt, ny = player.y + dy / l * sp * dt;
      // если игрока затолкало внутрь машины — не блокируем выход
      const inside = cars.some(c => pointInCar(player.x, player.y, c));
      if (!solidAt(nx, player.y) && (inside || !cars.some(c => pointInCar(nx, player.y, c)))) player.x = nx;
      if (!solidAt(player.x, ny) && (inside || !cars.some(c => pointInCar(player.x, ny, c)))) player.y = ny;
    }
    if (mouse.down) tryShoot();
  }
  // подбор предметов
  for (const pk of pickups) {
    if (dist(pk, player) < 22) {
      pk.remove = true;
      if (pk.kind === 'money') { const v = rndi(20, 120); money += v; SFX.cash(); toast(`+$${v}`, 1); }
      else if (pk.kind === 'health') { player.hp = Math.min(100, player.hp + 50); SFX.pickup(); toast('Здоровье +50', 1); }
      else { player.weapons[pk.kind] = (player.weapons[pk.kind] || 0) + (pk.kind === 'uzi' ? 90 : pk.kind === 'shotgun' ? 16 : 30); player.weapon = pk.kind; SFX.pickup(); toast(`${WEAPONS[pk.kind].name} подобран`, 1.2); }
      updateHud();
    }
  }
}

// ---------- Розыск ----------
function addWanted(n) { wanted = clamp(wanted + n, 0, 5); heat = 1; updateHud(); }
function updateWanted(dt) {
  const copNear = peds.some(p => !p.dead && p.kind === 'cop' && dist(p, player) < 600) || cars.some(c => c.type === 'police' && c.driver === 'npc' && dist(c, player) < 700);
  if (wanted > 0) {
    if (copNear) heat = 1; else heat -= dt / 12;
    if (heat <= 0) { wanted--; heat = 1; updateHud(); if (wanted === 0) { toast('Розыск снят'); for (const p of peds) if (p.kind === 'cop' && p.state === 'chase') p.state = 'walk'; } }
    const copCars = cars.filter(c => c.type === 'police' && !c.dead && c.driver === 'npc').length;
    const copsFoot = peds.filter(p => p.kind === 'cop' && !p.dead).length;
    const need = [0, 1, 2, 3, 4, 6][wanted];
    if (copCars < need && copsFoot < need * 2 && Math.random() < dt * 0.6) {
      const c = spawnTrafficCar(player.x, player.y, 700, 1100);
      if (c) { c.type = 'police'; c.color = '#f5f5f5'; c.hp = c.maxHp = 120; c.l = 48; c.ai = false; c.police = true; c.decided = false; }
    }
  } else {
    for (const c of cars) if (c.police && c.driver === 'npc' && dist(c, player) > 900) c.remove = true;
  }
}

// ---------- Миссии ----------
function missionKey() {
  if (mission) { failMission('Задание отменено'); return; }
  startMission(missionQueue[missionIdx % missionQueue.length]); missionIdx++;
}
function randomRoadPoint(minD = 900, maxD = 2200) {
  for (let i = 0; i < 100; i++) {
    const ix = rndi(3, 50), iy = rndi(3, 50);
    if (tileAt(ix, iy) !== TILE.ROAD || (isRoadIdx(ix) && isRoadIdx(iy))) continue;
    const p = { x: (ix + 0.5) * T, y: (iy + 0.5) * T };
    const d = dist(p, player); if (d >= minD && d <= maxD) return p;
  }
  return { x: T * 20, y: T * 20 };
}
function randomWalkPoint(minD = 700, maxD = 2000) {
  for (let i = 0; i < 100; i++) {
    const ix = rndi(4, 51), iy = rndi(4, 51);
    if (!walkable(tileAt(ix, iy))) continue;
    const p = { x: (ix + 0.5) * T, y: (iy + 0.5) * T };
    const d = dist(p, player); if (d >= minD && d <= maxD) return p;
  }
  return { x: T * 20, y: T * 20 };
}
function startMission(type) {
  mission = { type, stage: 0, timer: 0, reward: 0 };
  if (type === 'steal') {
    const p = randomRoadPoint(); const c = makeCar(p.x, p.y, pick([0, Math.PI / 2]), 'sports'); c.color = '#00e5ff'; c.marked = true; cars.push(c);
    mission.car = c; mission.target = p; mission.drop = randomRoadPoint(1200, 2600); mission.reward = 1500;
    mission.text = `<b>УГОН.</b> Найди помеченную спортивную тачку (голубая) и пригони её в гараж.`;
  } else if (type === 'courier') {
    mission.target = randomRoadPoint(800, 1500); mission.timer = 45; mission.reward = 1200; mission.legs = 2;
    mission.text = `<b>КУРЬЕР.</b> Успей доставить посылку в точку за отведённое время.`;
  } else if (type === 'gang') {
    const p = randomWalkPoint(); mission.target = p; mission.gang = [];
    for (let i = 0; i < 4; i++) { const g = makePed(p.x + rnd(-60, 60), p.y + rnd(-60, 60), 'gang'); g.hp = 50; peds.push(g); mission.gang.push(g); }
    mission.reward = 2000;
    mission.text = `<b>РАЗБОРКА.</b> Бандиты заняли район. Зачисти их всех (4).`;
  } else if (type === 'taxi') {
    const p = randomWalkPoint(600, 1400); mission.target = p;
    const ped = makePed(p.x, p.y); ped.state = 'wait'; ped.shirt = '#ffd84a'; ped.passenger = true; peds.push(ped);
    mission.passenger = ped; mission.drop = randomRoadPoint(1200, 2600); mission.reward = 900;
    mission.text = `<b>ТАКСИ.</b> Подбери клиента на машине (подъедь к нему) и отвези по адресу.`;
  }
  SFX.pickup(); updateHud();
}
function completeMission() {
  money += mission.reward; SFX.done(); toast(`ЗАДАНИЕ ВЫПОЛНЕНО: +$${mission.reward}`, 4);
  cleanupMission(); mission = null; updateHud();
}
function failMission(why) {
  SFX.fail(); toast(`ЗАДАНИЕ ПРОВАЛЕНО: ${why}`, 3);
  cleanupMission(); mission = null; updateHud();
}
function cleanupMission() {
  if (mission.car) mission.car.marked = false;
  if (mission.passenger) { mission.passenger.passenger = false; mission.passenger.inCar = null; mission.passenger.state = 'walk'; }
  if (mission.gang) for (const g of mission.gang) if (!g.dead) g.state = 'guard';
}
function updateMission(dt) {
  if (!mission) return;
  const m = mission;
  if (m.type === 'steal') {
    if (m.car.dead) return failMission('Машина уничтожена');
    if (m.stage === 0) { m.target = { x: m.car.x, y: m.car.y }; if (player.car === m.car) { m.stage = 1; m.target = m.drop; m.text = '<b>УГОН.</b> Отлично! Теперь доставь её в гараж, не разбив.'; toast('Гони в гараж!'); } }
    else if (player.car === m.car && dist(player, m.drop) < 50) completeMission();
  } else if (m.type === 'courier') {
    m.timer -= dt;
    if (m.timer <= 0) return failMission('Время вышло');
    if (dist(player, m.target) < 50) {
      m.legs--;
      if (m.legs <= 0) completeMission();
      else { m.target = randomRoadPoint(900, 1600); m.timer += 35; toast('Ещё одна точка!'); }
    }
  } else if (m.type === 'gang') {
    const alive = m.gang.filter(g => !g.dead);
    m.text = `<b>РАЗБОРКА.</b> Зачисти бандитов: осталось ${alive.length}.`;
    if (alive.length) { const nearest = alive.reduce((a, b) => dist(a, player) < dist(b, player) ? a : b); m.target = { x: nearest.x, y: nearest.y }; }
    else completeMission();
  } else if (m.type === 'taxi') {
    const p = m.passenger;
    if (m.stage === 0) {
      m.target = { x: p.x, y: p.y };
      if (player.car && !player.car.dead && dist(player.car, p) < 60 && Math.abs(player.car.v) < 30) {
        p.inCar = player.car; m.stage = 1; m.target = m.drop; m.timer = 60;
        m.text = '<b>ТАКСИ.</b> Клиент в машине. Вези по адресу, не угробь.'; toast('Клиент сел. Поехали!');
      }
    } else {
      m.timer -= dt;
      if (m.timer <= 0) return failMission('Клиент ушёл — слишком долго');
      if (!player.car || player.car !== p.inCar) { if (player.car === null && dist(player, p.inCar) > 200) return failMission('Ты бросил клиента'); }
      if (player.car === p.inCar && dist(player, m.drop) < 50 && Math.abs(player.car.v) < 30) { p.inCar = null; p.x = player.car.x + 30; p.y = player.car.y; completeMission(); }
    }
  }
  if (mission) el('mission').innerHTML = m.text + (m.timer > 0 && (m.type === 'courier' || m.stage === 1) ? `<br>Время: ${Math.ceil(m.timer)}с` : '');
}

// ---------- HUD ----------
function updateHud() {
  el('money').textContent = '$' + money.toLocaleString('ru-RU');
  el('stars').innerHTML = [1, 2, 3, 4, 5].map(i => `<span class="${i <= wanted ? 'on' : 'off'}">★</span>`).join('');
  el('health').style.width = Math.max(0, player.hp) + '%';
  el('health').style.background = player.hp > 40 ? 'linear-gradient(90deg,#4caf50,#8bc34a)' : '#e53935';
  const w = WEAPONS[player.weapon], ammo = player.weapons[player.weapon];
  el('weapon').textContent = `${w.name}${isFinite(ammo) ? ' · ' + ammo : ''}`;
  if (!mission) el('mission').innerHTML = '';
}

// ---------- Обновление ----------
function update(dt) {
  time += dt;
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) el('toast').classList.remove('show'); }
  updatePlayer(dt);
  for (const c of cars) {
    if (c.dead) { if (c.fire > 0) { c.fire -= dt; if (Math.random() < dt * 25) parts.push({ x: c.x + rnd(-15, 15), y: c.y + rnd(-10, 10), vx: rnd(-15, 15), vy: rnd(-40, -10), life: rnd(0.4, 0.9), c: pick(['#ff9800', '#ff5722', '#444', '#222']), r: rnd(4, 9) }); } else if (dist(c, player) > 1000) c.remove = true; continue; }
    if (c.driver === 'player') continue;
    if (c.police && c.driver === 'npc') updatePoliceCar(c, dt);
    else if (c.ai) updateAiCar(c, dt);
    else { c.v -= c.v * 3 * dt; if (Math.abs(c.v) > 1) moveCar(c, dt, 'none'); }
    if (c.driver === 'npc' && !c.police && dist(c, player) > 1500) c.remove = true;
    if (c.driver === null && !c.marked && c !== player.car && dist(c, player) > 2200) c.remove = true;
    if (c.hp < c.maxHp * 0.3 && Math.random() < dt * 8) parts.push({ x: c.x, y: c.y, vx: rnd(-10, 10), vy: rnd(-30, -10), life: 0.8, c: '#555', r: 4 });
  }
  for (const p of peds) { updatePed(p, dt); if (!p.dead && p.kind === 'civ' && dist(p, player) > 1500) p.remove = true; }
  // пули
  for (const b of bullets) {
    b.life -= dt; if (b.life <= 0) { b.remove = true; continue; }
    const steps = 3;
    for (let s = 0; s < steps && !b.remove; s++) {
      b.x += b.vx * dt / steps; b.y += b.vy * dt / steps;
      if (solidAt(b.x, b.y)) { b.remove = true; parts.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.2, c: '#ddd', r: 2 }); break; }
      if (b.owner !== 'player') {
        if (!player.car && dist(b, player) < 11) { hurtPlayer(b.dmg, b.owner === 'cop' ? 'полиция' : 'бандиты'); b.remove = true; break; }
        if (player.car && pointInCar(b.x, b.y, player.car)) { damageCar(player.car, b.dmg * 1.3, b.owner); if (Math.random() < 0.3) hurtPlayer(b.dmg * 0.6, b.owner === 'cop' ? 'полиция' : 'бандиты'); b.remove = true; break; }
      }
      for (const p of peds) if (!p.dead && !p.inCar && p.kind !== b.owner && dist(b, p) < 11) { hurtPed(p, b.dmg, b.owner); b.remove = true; break; }
      if (b.remove) break;
      for (const c of cars) if (!c.dead && c !== player.car && pointInCar(b.x, b.y, c)) {
        damageCar(c, b.dmg, b.owner); b.remove = true;
        if (c.driver === 'npc' && b.owner === 'player' && !c.police) { c.ai = true; c.stuck = 0; }
        parts.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.15, c: '#ffd', r: 3 });
        break;
      }
    }
  }
  for (const p of parts) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9; if (p.life <= 0) p.remove = true; }
  for (const pk of pickups) pk.t += dt;
  updateWanted(dt);
  updateMission(dt);
  // поддержание населения
  const civCars = cars.filter(c => c.driver === 'npc' && !c.police).length;
  if (civCars < 28 && Math.random() < dt * 2) spawnTrafficCar(player.x, player.y, 800, 1300);
  const civ = peds.filter(p => !p.dead && p.kind === 'civ').length;
  if (civ < 55 && Math.random() < dt * 3) spawnPed(player.x, player.y, 600, 1100);
  if (pickups.filter(p => p.kind === 'money').length < 10 && Math.random() < dt * 0.2) spawnPickup('money');
  cars = cars.filter(c => !c.remove); peds = peds.filter(p => !p.remove); bullets = bullets.filter(b => !b.remove);
  parts = parts.filter(p => !p.remove); pickups = pickups.filter(p => !p.remove);
  // камера
  const tz = player.car ? 0.78 : 1;
  cam.zoom += (tz - cam.zoom) * clamp(dt * 3, 0, 1);
  const lead = player.car ? player.car.v * 0.35 : 0;
  const cx = player.x + Math.cos(player.a) * lead, cy = player.y + Math.sin(player.a) * lead;
  cam.x += (cx - cam.x) * clamp(dt * 5, 0, 1); cam.y += (cy - cam.y) * clamp(dt * 5, 0, 1);
  if (shake > 0) shake = Math.max(0, shake - dt * 25);
}

// ---------- Рендер ----------
function render() {
  const cw = canvas.width, ch = canvas.height;
  ctx.save();
  ctx.fillStyle = '#1b2f4a'; ctx.fillRect(0, 0, cw, ch);
  const sx = shake ? rnd(-shake, shake) : 0, sy = shake ? rnd(-shake, shake) : 0;
  ctx.translate(cw / 2 + sx, ch / 2 + sy); ctx.scale(cam.zoom, cam.zoom); ctx.translate(-cam.x, -cam.y);
  const vw = cw / cam.zoom, vh = ch / cam.zoom;
  const x0 = Math.max(0, tx(cam.x - vw / 2) - 1), x1 = Math.min(W - 1, tx(cam.x + vw / 2) + 1);
  const y0 = Math.max(0, tx(cam.y - vh / 2) - 1), y1 = Math.min(H - 1, tx(cam.y + vh / 2) + 1);
  // земля
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = tileAt(x, y), px = x * T, py = y * T;
    switch (t) {
      case TILE.ROAD: ctx.fillStyle = '#3b3b40'; break;
      case TILE.WALK: ctx.fillStyle = '#9a9a96'; break;
      case TILE.BUILDING: ctx.fillStyle = '#8c8c88'; break;
      case TILE.GRASS: ctx.fillStyle = '#5c8a46'; break;
      case TILE.WATER: ctx.fillStyle = '#2a5d8f'; break;
      case TILE.LOT: ctx.fillStyle = '#55555a'; break;
      case TILE.SAND: ctx.fillStyle = '#d8c58a'; break;
    }
    ctx.fillRect(px, py, T, T);
    if (t === TILE.WATER) { ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(px + ((time * 20 + x * 13) % T), py + 20, 14, 2); }
    if (t === TILE.WALK) { ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.strokeRect(px + 0.5, py + 0.5, T - 1, T - 1); }
    if (t === TILE.ROAD) {
      const rx = isRoadIdx(x), ry = isRoadIdx(y);
      ctx.fillStyle = '#d8d070';
      if (ry && !rx && (y - 2) % 8 === 0) for (let i = 0; i < T; i += 24) ctx.fillRect(px + i, py + T - 2, 12, 3); // разделительная горизонт.
      if (rx && !ry && (x - 2) % 8 === 0) for (let i = 0; i < T; i += 24) ctx.fillRect(px + T - 2, py + i, 3, 12);
      // бордюры
      ctx.fillStyle = '#c2c2bd';
      if (!ry) { if (!isRoadIdx(x - 1) && tileAt(x - 1, y) !== TILE.WATER) ctx.fillRect(px, py, 3, T); if (!isRoadIdx(x + 1) && tileAt(x + 1, y) !== TILE.WATER) ctx.fillRect(px + T - 3, py, 3, T); }
      if (!rx) { if (!isRoadIdx(y - 1) && tileAt(x, y - 1) !== TILE.WATER) ctx.fillRect(px, py, T, 3); if (!isRoadIdx(y + 1) && tileAt(x, y + 1) !== TILE.WATER) ctx.fillRect(px, py + T - 3, T, 3); }
      // зебра
      if (rx && ry) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        const ex = (x - 2) % 8 === 0 ? px : px + T - 6, ey = (y - 2) % 8 === 0 ? py : py + T - 6;
        if (!isRoadIdx(x + ((x - 2) % 8 === 0 ? -1 : 1)) ) for (let i = 4; i < T; i += 12) ctx.fillRect(ex, py + i, 6, 6);
        if (!isRoadIdx(y + ((y - 2) % 8 === 0 ? -1 : 1)) ) for (let i = 4; i < T; i += 12) ctx.fillRect(px + i, ey, 6, 6);
      }
    }
  }
  // маркер миссии
  if (mission && mission.target) {
    const t = mission.target, r = 40 + Math.sin(time * 4) * 4;
    ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, TAU); ctx.fillStyle = 'rgba(255,216,74,0.25)'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#ffd84a'; ctx.stroke();
  }
  // пикапы
  for (const pk of pickups) {
    const bob = Math.sin(pk.t * 4) * 2;
    ctx.save(); ctx.translate(pk.x, pk.y + bob);
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU);
    ctx.fillStyle = pk.kind === 'money' ? '#2e7d32' : pk.kind === 'health' ? '#c62828' : '#37474f'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(pk.kind === 'money' ? '$' : pk.kind === 'health' ? '+' : pk.kind === 'uzi' ? 'U' : pk.kind === 'shotgun' ? 'S' : 'P', 0, 1);
    ctx.restore();
  }
  // трупы
  for (const p of peds) if (p.dead) drawPed(p);
  // машины
  for (const c of cars) drawCar(c);
  // живые пешеходы
  for (const p of peds) if (!p.dead && !p.inCar) drawPed(p);
  // игрок
  if (!player.car) drawPlayer();
  // пули
  ctx.strokeStyle = '#ffe082'; ctx.lineWidth = 2;
  for (const b of bullets) { ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.015, b.y - b.vy * 0.015); ctx.stroke(); }
  // частицы
  for (const p of parts) { ctx.globalAlpha = clamp(p.life * 2, 0, 1); ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill(); }
  ctx.globalAlpha = 1;
  // здания (псевдо-3D), от дальних к ближним
  const vis = buildings.filter(b => b.x + b.w > cam.x - vw / 2 - 200 && b.x < cam.x + vw / 2 + 200 && b.y + b.h > cam.y - vh / 2 - 200 && b.y < cam.y + vh / 2 + 200);
  vis.sort((a, b) => ((b.x + b.w / 2 - cam.x) ** 2 + (b.y + b.h / 2 - cam.y) ** 2) - ((a.x + a.w / 2 - cam.x) ** 2 + (a.y + a.h / 2 - cam.y) ** 2));
  for (const b of vis) drawBuilding(b);
  // деревья
  for (const t of trees) {
    if (t.x < cam.x - vw / 2 - 40 || t.x > cam.x + vw / 2 + 40 || t.y < cam.y - vh / 2 - 40 || t.y > cam.y + vh / 2 + 40) continue;
    const ox = (t.x - cam.x) * 0.03, oy = (t.y - cam.y) * 0.03;
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(t.x + ox * 1.5, t.y + oy * 1.5, t.r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2f6b2f'; ctx.beginPath(); ctx.arc(t.x + ox, t.y + oy, t.r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3f8a3a'; ctx.beginPath(); ctx.arc(t.x + ox - 2, t.y + oy - 2, t.r * 0.6, 0, TAU); ctx.fill();
  }
  ctx.restore();
  renderMinimap();
}

function drawBuilding(b) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const k = 0.012 * b.floors;
  const ox = clamp((cx - cam.x) * k, -b.w * 0.9, b.w * 0.9), oy = clamp((cy - cam.y) * k, -b.h * 0.9, b.h * 0.9);
  // тень
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(b.x + b.floors * 2, b.y + b.floors * 2, b.w, b.h);
  const wall = (p1, p2, p3, p4, shade) => { ctx.fillStyle = shade; ctx.beginPath(); ctx.moveTo(...p1); ctx.lineTo(...p2); ctx.lineTo(...p3); ctx.lineTo(...p4); ctx.closePath(); ctx.fill(); };
  const dark = shadeColor(b.color, -0.35), mid = shadeColor(b.color, -0.2);
  const rx = b.x + ox, ry = b.y + oy;
  if (ox > 0) wall([b.x, b.y], [b.x, b.y + b.h], [rx, ry + b.h], [rx, ry], dark);
  if (ox < 0) wall([b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [rx + b.w, ry + b.h], [rx + b.w, ry], dark);
  if (oy > 0) wall([b.x, b.y], [b.x + b.w, b.y], [rx + b.w, ry], [rx, ry], mid);
  if (oy < 0) wall([b.x, b.y + b.h], [b.x + b.w, b.y + b.h], [rx + b.w, ry + b.h], [rx, ry + b.h], mid);
  // окна на стенах
  ctx.fillStyle = 'rgba(255,255,220,0.25)';
  if (ox > 0 || ox < 0) {
    const wx = ox > 0 ? b.x : b.x + b.w;
    for (let f = 0; f < b.floors; f++) for (let i = 10; i < b.h - 8; i += 18) {
      const t = (f + 0.5) / b.floors;
      ctx.fillRect(wx + ox * t - 2, b.y + i + oy * t, 4, 8);
    }
  }
  // крыша
  ctx.fillStyle = b.color; ctx.fillRect(rx, ry, b.w, b.h);
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(rx + 6, ry + 6, b.w - 12, b.h - 12);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1; ctx.strokeRect(rx + 0.5, ry + 0.5, b.w - 1, b.h - 1);
  if (b.floors > 4) { ctx.fillStyle = '#777'; ctx.fillRect(rx + b.w / 2 - 8, ry + b.h / 2 - 8, 16, 16); }
}
const shadeCache = {};
function shadeColor(hex, f) {
  const k = hex + f; if (shadeCache[k]) return shadeCache[k];
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) * (1 + f), 0, 255) | 0, g = clamp(((n >> 8) & 255) * (1 + f), 0, 255) | 0, b = clamp((n & 255) * (1 + f), 0, 255) | 0;
  return shadeCache[k] = `rgb(${r},${g},${b})`;
}

function drawCar(c) {
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
  const l = c.l, w = c.w;
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-l / 2 + 3, -w / 2 + 3, l, w);
  ctx.fillStyle = c.dead ? '#222' : c.color; roundRect(-l / 2, -w / 2, l, w, 5); ctx.fill();
  if (c.marked) { ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 3; roundRect(-l / 2 - 3, -w / 2 - 3, l + 6, w + 6, 7); ctx.stroke(); }
  if (!c.dead) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-l / 2 + 8, -w / 2 + 2, l - 16, w - 4); // крыша темнее
    ctx.fillStyle = '#9fd3ff'; ctx.fillRect(l / 2 - 16, -w / 2 + 3, 5, w - 6); ctx.fillRect(-l / 2 + 8, -w / 2 + 3, 4, w - 6); // стёкла
    ctx.fillStyle = '#fff6c0'; ctx.fillRect(l / 2 - 3, -w / 2 + 2, 3, 5); ctx.fillRect(l / 2 - 3, w / 2 - 7, 3, 5);
    ctx.fillStyle = '#e53935'; ctx.fillRect(-l / 2, -w / 2 + 2, 3, 5); ctx.fillRect(-l / 2, w / 2 - 7, 3, 5);
    if (c.type === 'police') {
      ctx.fillStyle = '#1e3a8a'; ctx.fillRect(-l / 2 + 2, -w / 2, l - 4, 4); ctx.fillRect(-l / 2 + 2, w / 2 - 4, l - 4, 4);
      const on = c.driver === 'npc'; const ph = Math.floor(c.siren * 6) % 2;
      ctx.fillStyle = on ? (ph ? '#ff1744' : '#2979ff') : '#555'; ctx.fillRect(-4, -w / 2 + 5, 8, 5);
      ctx.fillStyle = on ? (ph ? '#2979ff' : '#ff1744') : '#555'; ctx.fillRect(-4, w / 2 - 10, 8, 5);
    }
    if (c.type === 'taxi') { ctx.fillStyle = '#111'; ctx.fillRect(-5, -4, 10, 8); }
    if (c.hp < c.maxHp * 0.5) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(l / 2 - 10, -w / 2, 6, w); }
  } else {
    ctx.fillStyle = '#111'; ctx.fillRect(-l / 2 + 6, -w / 2 + 2, l - 12, w - 4);
  }
  ctx.restore();
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function drawPed(p) {
  ctx.save(); ctx.translate(p.x, p.y);
  if (p.dead) {
    ctx.globalAlpha = clamp(p.dead / 5, 0, 1);
    ctx.fillStyle = 'rgba(150,0,0,0.6)'; ctx.beginPath(); ctx.ellipse(0, 0, 18, 12, p.a, 0, TAU); ctx.fill();
    ctx.rotate(p.a); ctx.fillStyle = p.shirt; ctx.fillRect(-10, -5, 20, 10); ctx.fillStyle = p.skin; ctx.beginPath(); ctx.arc(12, 0, 5, 0, TAU); ctx.fill();
    ctx.restore(); return;
  }
  ctx.rotate(p.a);
  const step = Math.sin(time * 12 + p.speed) * 3;
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(2, 2, 8, 0, TAU); ctx.fill();
  ctx.fillStyle = p.shirt; ctx.beginPath(); ctx.ellipse(0, 0, 7, 9, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = p.skin; ctx.beginPath(); ctx.arc(0, -8 + step, 3, 0, TAU); ctx.arc(0, 8 - step, 3, 0, TAU); ctx.fill(); // руки
  ctx.beginPath(); ctx.arc(1, 0, 5, 0, TAU); ctx.fill(); // голова
  if (p.kind === 'cop') { ctx.fillStyle = '#0d2b6b'; ctx.beginPath(); ctx.arc(1, 0, 4, 0, TAU); ctx.fill(); }
  if (p.kind === 'gang') { ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(1, 0, 4, 0, TAU); ctx.fill(); }
  if (p.state === 'chase' || p.state === 'guard') { ctx.fillStyle = '#222'; ctx.fillRect(4, -2, 10, 3); }
  if (p.passenger && p.state === 'wait') { ctx.rotate(-p.a); ctx.fillStyle = '#ffd84a'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center'; ctx.fillText('!', 0, -14 + Math.sin(time * 5) * 2); }
  ctx.restore();
}
function drawPlayer() {
  const p = player;
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(2, 2, 9, 0, TAU); ctx.fill();
  ctx.fillStyle = '#263238'; ctx.beginPath(); ctx.ellipse(0, 0, 8, 10, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#f1c27d';
  const w = WEAPONS[p.weapon];
  if (w.melee) { const ext = p.punchT > 0 ? 8 : 0; ctx.beginPath(); ctx.arc(4 + ext, -8, 3.5, 0, TAU); ctx.arc(4, 8, 3.5, 0, TAU); ctx.fill(); }
  else { ctx.beginPath(); ctx.arc(6, -4, 3.5, 0, TAU); ctx.arc(6, 4, 3.5, 0, TAU); ctx.fill(); ctx.fillStyle = '#111'; ctx.fillRect(6, -2, p.weapon === 'shotgun' ? 18 : p.weapon === 'uzi' ? 14 : 11, 4); }
  ctx.fillStyle = '#f1c27d'; ctx.beginPath(); ctx.arc(1, 0, 5.5, 0, TAU); ctx.fill();
  ctx.fillStyle = '#3e2723'; ctx.beginPath(); ctx.arc(0, 0, 4.5, Math.PI * 0.6, Math.PI * 1.4); ctx.fill();
  ctx.restore();
}

function renderMinimap() {
  const S = mini.width, scale = S / (T * 28); // радиус обзора 14 тайлов
  mctx.clearRect(0, 0, S, S);
  mctx.save();
  mctx.beginPath(); mctx.arc(S / 2, S / 2, S / 2, 0, TAU); mctx.clip();
  mctx.fillStyle = '#2a5d8f'; mctx.fillRect(0, 0, S, S);
  mctx.translate(S / 2, S / 2); mctx.scale(scale, scale); mctx.translate(-player.x, -player.y);
  const x0 = Math.max(0, tx(player.x) - 15), x1 = Math.min(W - 1, tx(player.x) + 15), y0 = Math.max(0, tx(player.y) - 15), y1 = Math.min(H - 1, tx(player.y) + 15);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = tileAt(x, y);
    mctx.fillStyle = t === TILE.ROAD ? '#555' : t === TILE.BUILDING ? '#9a8f80' : t === TILE.GRASS ? '#4a7a3a' : t === TILE.WATER ? '#2a5d8f' : t === TILE.SAND ? '#d8c58a' : '#bbb';
    mctx.fillRect(x * T, y * T, T, T);
  }
  for (const c of cars) if (c.police && c.driver === 'npc') { mctx.fillStyle = '#2979ff'; mctx.beginPath(); mctx.arc(c.x, c.y, 24, 0, TAU); mctx.fill(); }
  for (const p of peds) if (!p.dead && (p.kind === 'cop' || p.kind === 'gang')) { mctx.fillStyle = p.kind === 'cop' ? '#2979ff' : '#e53935'; mctx.beginPath(); mctx.arc(p.x, p.y, 18, 0, TAU); mctx.fill(); }
  for (const pk of pickups) { mctx.fillStyle = pk.kind === 'money' ? '#5ad46a' : pk.kind === 'health' ? '#ff5252' : '#fff'; mctx.beginPath(); mctx.arc(pk.x, pk.y, 12, 0, TAU); mctx.fill(); }
  if (mission && mission.target) {
    const t = mission.target, dx = t.x - player.x, dy = t.y - player.y, d = Math.hypot(dx, dy), maxR = T * 13;
    const px = d > maxR ? player.x + dx / d * maxR : t.x, py = d > maxR ? player.y + dy / d * maxR : t.y;
    mctx.fillStyle = '#ffd84a'; mctx.beginPath(); mctx.arc(px, py, 30, 0, TAU); mctx.fill();
  }
  mctx.save(); mctx.translate(player.x, player.y); mctx.rotate(player.a);
  mctx.fillStyle = '#fff'; mctx.beginPath(); mctx.moveTo(34, 0); mctx.lineTo(-22, -22); mctx.lineTo(-22, 22); mctx.closePath(); mctx.fill();
  mctx.restore(); mctx.restore();
}

// ---------- Цикл ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (running) update(dt);
  if (player) render();
  requestAnimationFrame(loop);
}
window.__dbg = () => ({ cars, peds, player, wanted, mission, cam });
generateMap();
player = makePlayer(T * 20.5, T * 20.5); cam.x = player.x; cam.y = player.y;
requestAnimationFrame(loop);
})();
