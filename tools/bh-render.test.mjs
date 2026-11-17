// node --test tools/bh-render.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const fn = name => { const i = html.indexOf(`function ${name}(`); return html.slice(i, html.indexOf('\n}', i) + 2); };
function camera(offset) {
  const ctx = vm.createContext({
    SET: { bh: true }, bhPreview: null, BH: [33250, 11400, -88350], BH_R_JS: 900, BH_FAR_JS: 400000,
    posX: 33250 + offset[0], posY: 11400 + offset[1], posZ: -88350 + offset[2], scale: 1,
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  });
  vm.runInContext(['bhVisual', 'bhSkyFade', 'bhOcclusionPoint', 'bhVisibility'].map(fn).join('\n'), ctx);
  return ctx;
}
test('effect boundary reaches zero continuously; backwards rays inside have no hemisphere cut', () => {
  const c = camera([0, 0, 8000]);
  const sample = impact => c.bhSkyFade([impact / 8000, 0, -Math.sqrt(1 - (impact / 8000) ** 2)]);
  assert.equal(sample(4680), 0);
  assert.ok(sample(4680 - 0.1) < 1e-6);
  const inside = camera([2000, 0, 0]);
  assert.ok(Math.abs(inside.bhSkyFade([1e-6, 1, 0]) - inside.bhSkyFade([-1e-6, 1, 0])) < 1e-9);
  assert.ok(inside.bhSkyFade([1, 0, 0]) > 0, 'outward ray remains in effect');
});
test('disk opacity is continuous through the plane and symmetric above/below', () => {
  const values = [];
  for (const y of [-0.01, 0, 0.01]) {
    const c = camera([2400, y, 3000]);
    const s = c.bhOcclusionPoint(c.posX + 200000, c.posY, c.posZ);
    values.push(s.alpha);
    assert.ok(s.alpha > 0, 'coplanar ray sees gas');
    assert.ok(Number.isFinite(s.depth));
  }
  assert.ok(Math.max(...values) - Math.min(...values) < 1e-4);
  const a = camera([2600, 2400, 2000]), b = camera([2600, -2400, 2000]);
  assert.ok(Math.abs(a.bhOcclusionPoint(...a.BH).alpha - b.bhOcclusionPoint(...b.BH).alpha) < 1e-12);
});
test('shadow is opaque; foreground remains visible; quality never changes geometry', () => {
  const c = camera([2200, 754, -5846]);
  assert.equal(c.bhVisibility(0, 0, 0), 0, 'solar system behind shadow');
  const front = c.BH.map((v, i) => v + [2200, 754, -5846][i] * 0.9);
  assert.equal(c.bhVisibility(...front), 1, 'object before black hole');
  const high = c.bhOcclusionPoint(0, 0, 0);
  c.scale = 0.65;
  assert.deepEqual(c.bhOcclusionPoint(0, 0, 0), high);
});
test('procedural angular coordinates agree at -pi/+pi', () => {
  const frequency = +html.match(/let q2 = vec2f\(cos\(a \* ([\d.]+)/)[1];
  for (const time of [0, 12, 100]) for (const r of [1.45, 2, 4.6]) {
    const phase = 1.7 - Math.log(r) * 2 - 0.85 * r ** -1.5 * time * frequency;
    assert.ok(Math.abs(Math.cos(-Math.PI * frequency + phase) - Math.cos(Math.PI * frequency + phase)) < 1e-12);
    assert.ok(Math.abs(Math.sin(-Math.PI * frequency + phase) - Math.sin(Math.PI * frequency + phase)) < 1e-12);
  }
});
