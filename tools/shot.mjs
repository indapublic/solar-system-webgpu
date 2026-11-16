// Снимок страницы через DevTools Protocol в настоящем Chrome (headless=new + реальное время),
// потому что --virtual-time-budget не даёт GPU-работе завершиться.
//   node tools/shot.mjs <url> <out.png> [waitMs] [w] [h] [--headless]
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, out = 'shot.png', waitMs = '6000', w = '1600', h = '900'] = process.argv.slice(2);
const headless = process.argv.includes('--headless');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profArg = process.argv.indexOf('--profile');
const profile = profArg > 0 && process.argv[profArg + 1] ? process.argv[profArg + 1] : await mkdtemp(join(tmpdir(), 'ndshot-'));
const port = 9300 + Math.floor(Math.random() * 400);

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu',
  '--disable-features=CalculateNativeWinOcclusion',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  `--window-size=${w},${h}`,
  ...(headless ? ['--headless=new'] : ['--window-position=20,20']),
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(100);
  }
  throw new Error('no devtools target');
}

const ws = new WebSocket(await target());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    logs.push('EXCEPTION: ' + (d.exception?.description || d.text));
  }
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id;
  pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(+waitMs);

// --press Code — нажать клавишу перед снимком (например, Digit5)
const pi = process.argv.indexOf('--press');
if (pi > 0 && process.argv[pi + 1]) {
  await send('Runtime.evaluate', {
    expression: `dispatchEvent(new KeyboardEvent('keydown',{code:${JSON.stringify(process.argv[pi + 1])}}))`,
  });
  await sleep(1500);
}

// --js "<выражение>" — выполнить до снимка (например, открыть панель)
const ji = process.argv.indexOf('--js');
if (ji > 0 && process.argv[ji + 1]) {
  await send('Runtime.evaluate', { expression: process.argv[ji + 1] });
  await sleep(900);
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) await writeFile(out, Buffer.from(shot.result.data, 'base64'));
else console.log('screenshot failed', JSON.stringify(shot.error));

// --shot2 out2.png (+ --gap ms, по умолчанию 900) — второй кадр из той же сессии:
// так видно, что именно изменилось за время, без перезагрузки и нового набора случайностей
const si = process.argv.indexOf('--shot2');
if (si > 0 && process.argv[si + 1]) {
  const gi = process.argv.indexOf('--gap');
  await sleep(gi > 0 && process.argv[gi + 1] ? +process.argv[gi + 1] : 900);
  const s2 = await send('Page.captureScreenshot', { format: 'png' });
  if (s2.result?.data) await writeFile(process.argv[si + 1], Buffer.from(s2.result.data, 'base64'));
}

// текст ошибок со страницы, если он есть
const dom = await send('Runtime.evaluate', {
  expression: `(function(){const e=document.getElementById('err');const b=document.getElementById('boot');return JSON.stringify({title:document.title,err:e&&e.style.display!=='none'?e.textContent:'',boot:b&&!b.classList.contains('gone')?'loading':'ready'})})()`,
  returnByValue: true,
});
console.log('page:', dom.result?.result?.value);

// --eval "<выражение>" печатает результат вычисления на странице (например, показания HUD)
const ei = process.argv.indexOf('--eval');
if (ei > 0 && process.argv[ei + 1]) {
  const r = await send('Runtime.evaluate', { expression: process.argv[ei + 1], returnByValue: true, awaitPromise: true });
  console.log('eval:', JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.text ?? r.error));
}
if (logs.length) console.log('console:\n' + logs.join('\n'));

ws.close();
await sleep(1500);   // дать Chrome сбросить localStorage на диск
chrome.kill();
await sleep(200);
process.exit(0);
