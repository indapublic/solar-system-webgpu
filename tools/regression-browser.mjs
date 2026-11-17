// Real Chrome + WebGPU, no dependencies. node tools/regression-browser.mjs
// The local test server exposes closure state only in its HTML responses.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = await readFile(path.join(root, 'index.html'), 'utf8');
const wall = await readFile(path.join(root, 'wall.html'), 'utf8');
assert.equal(wall.replace(/<script>window\.__ASSETS=.*?<\/script>\r?\n/, ''), source, 'wall matches source');
const casesSource = await readFile(new URL('./regression.test.mjs', import.meta.url), 'utf8');
const start = casesSource.indexOf('function rockCases(');
const rockCases = casesSource.slice(start, casesSource.indexOf('\n}', start) + 2);
const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://localhost').pathname;
    if (name === '/' || name === '/wall.html') {
      const html = name === '/' ? source : wall;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html.replace('window.__ss =', 'window.__regression = code => eval(code);\nwindow.__ss ='));
    } else {
      const file = path.resolve(root, '.' + name);
      if (!file.startsWith(root)) throw Error('outside root');
      res.end(await readFile(file));
    }
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(tmpdir(), 'nd-regression-'));
const chrome = spawn(process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--headless=new',
  '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows', '--window-size=960,640', 'about:blank',
], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws;
const errors = [];
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; }
    catch { await sleep(100); }
  }
  assert.ok(port, 'Chrome starts');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const inside = code => evaluate(`__regression(${JSON.stringify(code)})`);
  const until = async (expression, timeout = 20000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(100); }
    throw Error(`Timeout: ${expression}`);
  };
  const key = (code, down) => send('Input.dispatchKeyEvent', {
    type: down ? 'keyDown' : 'keyUp', code, key: code.slice(3).toLowerCase(),
  });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  for (const page of ['/', '/wall.html']) {
    await send('Page.navigate', { url: base + page });
    await until('typeof __regression === "function"');
    await until('!!document.getElementById("shipSpeed")');
    if(await evaluate('document.getElementById("guide").open')) {
      const initial=await evaluate('__ss()');await sleep(300);
      assert.deepEqual(await evaluate('__ss()'),initial,'guide pauses camera');
      await evaluate('document.getElementById("guideRepeat").checked=false;document.getElementById("guideStart").click()');
    }
    await evaluate('document.getElementById("shipBtn").click()');
    assert.equal(await evaluate('document.querySelector("[data-section=ship]").hidden'),false);
    await evaluate('document.getElementById("gear").click();document.getElementById("gear").click()');
    assert.equal(await evaluate('document.querySelector("[data-section=graphics]").hidden'),false);
    await evaluate('document.querySelector(".menuHeader button").click()');
    console.log(page, 'GPU:', await inside('({ vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description, fallback: adapter.info.isFallbackAdapter })'));
    const reload = async () => {
      await send('Page.reload'); await sleep(250);
      await until('typeof __regression === "function"');
    };
    for(const mode of ['low','medium','full','auto']) {
      await evaluate(`document.querySelector('[data-q="${mode}"]').click()`);
      await sleep(150);
      const perf=await evaluate('__perf()');assert.equal(perf.quality,mode);
      console.log(page,'profile',perf);
    }
    await inside('setSafe(true);timeSpeed=0;__rockGo(0,0,-3)');
    await evaluate('document.getElementById("cSimpleRocks").click()');await sleep(300);
    assert.equal((await evaluate('__perf()')).simpleRocks,true,'simple asteroid GPU branch enabled');
    await reload();await until('!!document.getElementById("shipSpeed")');
    assert.equal((await evaluate('__perf()')).simpleRocks,true,'simple setting survives reload');
    assert.equal(await evaluate('document.getElementById("cSimpleRocks").checked'),true);
    await evaluate('document.getElementById("cSimpleRocks").click()');await sleep(150);
    assert.equal((await evaluate('__perf()')).simpleRocks,false,'procedural geometry restored');
    if(page==='/') {
      await evaluate('document.getElementById("shipBtn").click()');
      await mkdir(path.join(root,'docs/menu-review'),{recursive:true});
      const shot=await send('Page.captureScreenshot',{format:'png'});
      await writeFile(path.join(root,'docs/menu-review/ship.png'),Buffer.from(shot.data,'base64'));
      await send('Emulation.setDeviceMetricsOverride',{width:360,height:760,deviceScaleFactor:1,mobile:false});
      await inside("setLang('ru');showMenu('graphics')");await sleep(100);
      assert.equal(await evaluate('document.getElementById("panel").scrollWidth<=document.getElementById("panel").clientWidth'),true,'narrow menu fits');
      const mobile=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(root,'docs/menu-review/graphics-360.png'),Buffer.from(mobile.data,'base64'));
      await evaluate('document.querySelector(".menuHeader button").click()');
      await send('Emulation.clearDeviceMetricsOverride');
    }
    for (const safe of [false, true]) {
      await inside(`setSafe(${safe}); SET.fov=0.73; SET.bh=true; saveSettings()`);
      const saved = await evaluate('localStorage.getItem("nd.set")');
      await evaluate('__bhView("reference"); __bhView("plane")');
      const state = await inside('({safe:SET.safe,active:safeActive(),fov:SET.fov,checkbox:$("cSafe").checked,notice:!$("bhPreviewNotice").hidden})');
      assert.deepEqual(state,{safe,active:true,fov:0.73,checkbox:safe,notice:true});
      await inside('saveSettings()');
      assert.equal(await evaluate('localStorage.getItem("nd.set")'),saved,'other saves never persist preview overrides');
      if (!safe) {
        const shot=await send('Page.captureScreenshot',{format:'png'});
        await writeFile(path.join(root,'docs/bh-render',page==='/'?'preview-index.png':'preview-wall.png'),Buffer.from(shot.data,'base64'));
      }
      await evaluate('document.getElementById("bhPreviewExit").click()');
      assert.equal(await inside('bhPreview'),null);
      assert.equal(await evaluate('localStorage.getItem("nd.set")'),saved);
      await reload();
      assert.equal(await inside('SET.safe'),safe);
      await evaluate('__bhView("reference")');
      await reload(); // Reload while preview is still active.
      assert.equal(await inside('SET.safe'),safe);
      assert.equal(await inside('bhPreview'),null);
      assert.equal(await evaluate('localStorage.getItem("nd.set")'),saved);
      await evaluate('__bhView("reference")');
      await key('Escape',true); await key('Escape',false);
      assert.equal(await inside('bhPreview'),null);
      await evaluate('__bhView("reference")');
      await inside(`setSafe(${!safe})`); await evaluate('__bhViewEnd()');
      assert.equal(await inside('SET.safe'),!safe,'explicit choice during preview survives exit');
      await inside(`setSafe(${safe}); gotoBH()`);
      assert.equal(await inside('SET.safe'),safe,'ordinary gotoBH never toggles safe mode');
    }
    console.log(page,'preview exit, UI, persistence and actual reloads: PASS');
    await inside('cancelFlight(); SET.bh = true; setSafe(true); speedMul = 1; __bhGo(6000)');
    const before = await evaluate('__ss()');
    await key('KeyW', true); await sleep(1000); await key('KeyW', false);
    const after = await evaluate('__ss()');
    assert.ok(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z) > 100, 'safe W moves');
    assert.equal((await evaluate('__bhState()')).f, 0);
    console.log(page, 'safe W displacement:', Math.round(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z)));
    await inside('setSafe(false); __bhGo(6000)');
    await sleep(1000);
    const falling = await evaluate('__bhState()');
    assert.ok(falling.r < 5990 && falling.f > 0, 'gravity without input');
    await key('KeyW', true); await sleep(1000); await key('KeyW', false);
    assert.ok((await evaluate('__bhState()')).r < falling.r, 'fall with W');
    await inside('setSafe(true)');
    assert.equal((await evaluate('__bhState()')).f, 0);
    const r0 = (await evaluate('__bhState()')).r;
    await key('KeyS', true); await sleep(1000); await key('KeyS', false);
    assert.ok((await evaluate('__bhState()')).r > r0, 'safe toggle restores outward control');
    await inside('setSafe(true); __bhGo(650); speedMul = 100');
    await key('KeyW', true); await sleep(1000); await key('KeyW', false);
    assert.ok((await evaluate('__bhState()')).r >= await inside('BH_H * 1.12 - 1e-7'), 'safe boundary');
    await inside('speedMul = 1; setSafe(false); __bhGo(800)');
    await until('__bhState().sw', 20000);
    await key('KeyR', true); await key('KeyR', false);
    assert.equal((await evaluate('__bhState()')).sw, false);
    assert.ok((await evaluate('__bhState()')).r > 7000, 'R returns from hole');
    console.log(page, 'normal fall, safe toggle, boundary and return: PASS');
    const cases = await inside(`(${rockCases})(rockHitData, rotAxisJS, simDays)`);
    assert.equal(cases.length, 30);
    // Drive the actual collision/removal/debris pipeline through the new fragment.
    const corner = await inside(`(() => {
      cancelFlight();releaseTarget();clearHazards();timeSpeed=0;rockCool=0;
      const g=ROCK_BANDS[0],x=(g.rMin+g.rMax)/2;
      g.px[0]=x;g.py[0]=g.pz[0]=0;g.per[0]=Infinity;
      g.data.fill(0,0,ROCK_STRIDE);g.data[0]=x;g.data[3]=1;g.data[7]=0.24;
      g.data[8]=1.08;g.data[9]=0.83;g.data[10]=1;g.data[14]=g.data[17]=g.data[23]=1;
      const n=debris.length;posX=x+0.75;posY=0.65;posZ=0.1;velX=velY=velZ=0;
      rockStep(x+0.75,0.65,-0.1);
      return {removed:g.data[4]===-2,fragments:debris.length-n};
    })()`);
    assert.deepEqual(corner,{removed:false,fragments:0},'empty angular corner remains passable');
    const collision = await inside(`(() => {
      cancelFlight(); releaseTarget(); clearHazards(); timeSpeed = 0; rockCool = 0;
      const g = ROCK_BANDS[0], i = 0, o = 0;
      const x = (g.rMin + g.rMax) / 2;
      g.px[i] = x; g.py[i] = 0; g.pz[i] = 0; g.per[i] = Infinity;
      g.data.fill(0, o, o + ROCK_STRIDE);
      g.data[0] = x; g.data[3] = 1; g.data[8] = 1.1; g.data[9] = 0.8; g.data[10] = 1;
      g.data[14] = 1; g.data[17] = 1; g.data[23] = 1;
      Q.writeBuffer(g.buf, 0, g.data.subarray(0, ROCK_STRIDE));
      const n = debris.length;
      posX = x; posY = 0.8; posZ = 0; velX = velY = velZ = 0;
      rockStep(x + 1.1, 0, 0);
      return { removed: g.data[4] === -2, fragments: debris.length - n, dead: rockDead };
    })()`);
    assert.equal(collision.removed, true); assert.ok(collision.fragments > 0); assert.equal(collision.dead, false);
    await sleep(500);
    assert.ok((await evaluate('__fx()')).n > 0, 'fragments uploaded for rendering');
    await inside('device.queue.onSubmittedWorkDone()');
    assert.equal(await evaluate('document.getElementById("err").textContent'), '');
    console.log(page, '30 shape cases + actual angular collision/debris:', collision);
  }
  assert.deepEqual(errors, [], 'no browser/GPU errors');
  console.log('PASS: index and wall, real WebGPU frames, no GPU/browser errors; wall matches source.');
} finally {
  ws?.close(); chrome.kill(); server.closeAllConnections(); server.close();
  await sleep(1500);
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
}
