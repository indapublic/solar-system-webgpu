// node --test tools/regression.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const fn = (name) => {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return html.slice(start, html.indexOf('\n}', start) + 2);
};
const movement = html.slice(html.indexOf('  const falling ='), html.indexOf('  const bx0 ='));

export function rockCases(hit, rotate, days = 0) {
  const data = new Float64Array(24);
  data[3] = 1; data[8] = 1.1; data[9] = 0.8; data[10] = 1;
  data[14] = 1; data[17] = 1; data[23] = 1;
  const cases = [];
  const check = (name, a, b, expected, center = [0, 0, 0]) => {
    const actual = hit(data, 0, ...center, ...a, ...b);
    if (actual !== expected) throw new Error(`${name}: expected ${expected}, got ${actual}`);
    cases.push(name);
  };
  // Этот отрезок пересекал прежнюю коробку, но проходит вне новой клиновидной базы.
  check('old box diagonal misses fragment', [2, 0, 0], [0, 1.2, 0], false);
  check('oblique segment hits fragment', [1.1, 0, 0], [0, 0.8, 0], true);
  check('miss', [2, 2, 0], [-2, 2, 0], false);
  check('start inside', [0, 0, 0], [4, 0, 0], true);
  check('parallel inside slabs', [-2, 0.5, 0], [2, 0.5, 0], true);
  check('parallel outside slab', [2, -2, 0], [2, 2, 0], false);
  check('stationary inside', [0, 0, 0], [0, 0, 0], true);
  check('stationary outside', [2, 0, 0], [2, 0, 0], false);
  check('high speed', [-1e6, 0.6, 0], [1e6, 0.6, 0], true);
  check('old box face misses fragment', [-2, 0, 1], [2, 0, 1], false);
  check('segment ends before box', [3, 0, 0], [2, 0, 0], false);
  data[7]=0.24;data[8]=1.08;data[9]=0.83;
  check('reviewer empty angular corner', [0.75,0.65,-0.1], [0.75,0.65,0.1], false);
  check('opposite empty corner', [-0.75,-0.65,-0.1], [-0.75,-0.65,0.1], false);
  check('angular high speed empty corner', [0.75,0.65,-1e6], [0.75,0.65,1e6], false);
  check('angular high speed true hit', [-1e6,0.2,0], [1e6,0.2,0], true);
  check('angular surface neighbourhood hit', [-0.4,0.25,-2], [-0.4,0.25,2], true);
  data[15] = 0.13; data[19] = -0.07; data[20] = 0.7; data[21] = -0.4;
  data[3] = 3;
  const center = [100, -50, 20];
  const world = (p) => {
    let q = rotate(...p, 0, 0, 1, data[20] + data[15] * days);
    q = rotate(...q, 0, 1, 0, data[21] + data[19] * days);
    return q.map((v, i) => v * data[3] + center[i]);
  };
  check('rotating translated scaled fragment', world([1.1, 0, 0]), world([0, 0.8, 0]), true, center);
  check('rotated scaled empty corner', world([0.75,0.65,-0.1]), world([0.75,0.65,0.1]), false, center);
  check('rotated miss', world([2, 2, 0]), world([-2, 2, 0]), false, center);
  data[15] = data[19] = data[20] = data[21] = 0; data[3] = 1;
  for (const family of [1, 2, 3, 4]) {
    data[6] = family; data[22] = 0.6;
    check(`family ${family} hit`, [-5, 0, 0], [5, 0, 0], true);
    check(`family ${family} miss`, [-5, 5, 0], [5, 5, 0], false);
  }
  // Осколки используют тот же формат формы и меньший size.
  data[6] = 0; data[3] = -0.05;
  check('small angular fragment', [0.055, 0, 0], [0, 0.04, 0], true);
  check('small fragment empty corner', [0.0375,0.0325,-0.005], [0.0375,0.0325,0.005], false);
  data[3] = 0;
  check('zero size', [-1, 0, 0], [1, 0, 0], false);
  return cases;
}

test('asteroid segment regressions', () => {
  const ctx = vm.createContext({ simDays: 12, ROCK_STRIDE: 24 });
  vm.runInContext(fn('rotAxisJS') + '\n' + fn('rockHitData'), ctx);
  assert.equal(rockCases(ctx.rockHitData, ctx.rotAxisJS, 12).length, 30);
});

function physics() {
  const el = { style: {}, classList: { remove() {} } };
  const ctx = vm.createContext({
    SET: { bh: true, safe: false }, bhPreview: null, BH: [100000, 0, 0], BH_H: 500, BH_PULL: 7000,
    BH_AXIS: [0, 1, 0], posX: 106000, posY: 0, posZ: 0,
    velX: 0, velY: 0, velZ: 0, bhFall: 0, bhSwallowed: false,
    bodyFall: -1, rockDead: false, flight: false, BASE_SPEED: 100, speedMul: 1,
    keys: { boost: false }, fx: -1, fy: 0, fz: 0, az: 1, ax: 0, ay: 0,
    cy_: 1, sy_: 0, sp: 0, cp: 1, moving: 1, dt: 1 / 60,
    target: -1, lastLook: 0, performance: { now: () => 0 }, blendLook() {},
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    swallow() { ctx.bhSwallowed = true; }, SUN_R: 10, ALL: [], sunHeat: 0,
    bodyDead: -1, sunDead: false, entryHeat: 0,
    $: () => el, saveSettings() {}, toast() {}, T: (x) => x,
  });
  vm.runInContext(['safeActive', 'syncBHPreviewUI', 'bhStep', 'safeClamp', 'clearHazards', 'setSafe'].map(fn).join('\n'), ctx);
  return ctx;
}
const step = (ctx, n = 60) => {
  for (let i = 0; i < n; i++) {
    vm.runInContext(`{${movement}\n posX += velX * dt; posY += velY * dt; posZ += velZ * dt;}`, ctx);
  }
};

test('safe manual movement and enabling safe mode during fall', () => {
  const ctx = physics();
  ctx.setSafe(true); step(ctx);
  assert.ok(ctx.posX < 105950, 'W moves inside BH_PULL');
  assert.equal(ctx.bhFall, 0);
  ctx.setSafe(false); step(ctx);
  assert.ok(ctx.bhFall > 0);
  ctx.setSafe(true);
  assert.equal(ctx.bhFall, 0);
  const before = ctx.posX;
  step(ctx);
  assert.ok(ctx.posX < before);
  assert.equal(ctx.bhFall, 0);
});

test('normal gravity without input and swallowing', () => {
  const ctx = physics(); ctx.moving = 0; ctx.az = 0;
  step(ctx);
  assert.ok(ctx.posX < 106000);
  assert.ok(ctx.bhFall > 0);
  ctx.posX = 100100;
  ctx.bhStep(1 / 60);
  assert.equal(ctx.bhSwallowed, true);
});

test('safe boundary: penetration, high speed crossing, center, outward movement', () => {
  const ctx = physics(); ctx.setSafe(true);
  const min = ctx.BH_H * 1.12;
  for (const [start, end] of [[1000, 100], [1000, -1000], [0, 0]]) {
    ctx.posX = ctx.BH[0] + end; ctx.posY = ctx.posZ = 0;
    ctx.safeClamp(ctx.BH[0] + start, 0, 0);
    assert.ok(Math.abs(ctx.posX - ctx.BH[0]) >= min - 1e-8);
    if (start > 0) assert.ok(ctx.posX > ctx.BH[0], 'retain entry side');
  }
  ctx.posX = ctx.BH[0] + min + 100;
  ctx.safeClamp(ctx.BH[0] + min, 0, 0);
  assert.equal(ctx.posX, ctx.BH[0] + min + 100);
});
