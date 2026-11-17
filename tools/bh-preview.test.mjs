// node --test tools/bh-preview.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const fn = name => { const i = html.indexOf(`function ${name}(`); assert.ok(i >= 0); return html.slice(i, html.indexOf('\n}', i) + 2); };
const viewStart = html.indexOf('window.__bhView =');
const view = html.slice(viewStart, html.indexOf('\n};', viewStart) + 3);
function session(safe) {
  const elements = new Map();
  const saved = new Map();
  let writes = 0;
  const ctx = vm.createContext({
    SET: { safe, bh: false, fov: 0.91 }, bhPreview: null, BH: [33250, 11400, -88350],
    posX: 0, posY: 0, posZ: 0, velX: 0, velY: 0, velZ: 0, yaw: 0,
    window: { __ss: () => ({}) },
    $: id => { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); },
    T: (key, ...args) => [key, ...args].join(' '),
    clearHazards() {}, releaseTarget() {}, cancelFlight() {}, lookAt() {}, toast() {},
    store: { set: (k, v) => { writes++; saved.set(k, v); } },
  });
  vm.runInContext(['safeActive', 'syncBHPreviewUI', 'endBHPreview', 'saveSettings', 'setSafe'].map(fn).join('\n') + '\n' + view, ctx);
  ctx.setSafe(safe);
  return { ctx, elements, saved, writes: () => writes };
}
for (const safe of [false, true]) test(`preview leaves settings and saved safe=${safe} unchanged`, () => {
  const { ctx, saved, writes, elements } = session(safe);
  const before = JSON.stringify(ctx.SET), stored = saved.get('nd.set'), count = writes();
  ctx.window.__bhView('reference'); ctx.window.__bhView('plane');
  assert.equal(ctx.safeActive(), true);
  assert.equal(ctx.SET.safe, safe);
  assert.equal(JSON.stringify(ctx.SET), before, 'FOV and BH choice are unchanged too');
  assert.equal(writes(), count, 'entering and switching views never saves');
  assert.equal(elements.get('bhPreviewNotice').hidden, false);
  assert.equal(elements.get('cSafe').checked, safe);
  ctx.saveSettings(); // Saving another setting during preview must not leak overrides.
  assert.equal(saved.get('nd.set'), stored);
  ctx.endBHPreview(); ctx.endBHPreview();
  assert.equal(ctx.safeActive(), safe);
  assert.equal(elements.get('bhPreviewNotice').hidden, true);
  assert.equal(saved.get('nd.set'), stored);
  assert.equal(JSON.parse(stored).safe, safe, 'reload restores the user choice');
});
test('an explicit user change during preview is preserved on exit', () => {
  const { ctx, saved } = session(false);
  ctx.window.__bhView(); ctx.setSafe(true); ctx.endBHPreview();
  assert.equal(ctx.SET.safe, true); assert.equal(JSON.parse(saved.get('nd.set')).safe, true);
  ctx.window.__bhView(); ctx.setSafe(false);
  assert.equal(ctx.safeActive(), true, 'temporary protection stays active until exit');
  ctx.endBHPreview();
  assert.equal(ctx.safeActive(), false); assert.equal(JSON.parse(saved.get('nd.set')).safe, false);
});
