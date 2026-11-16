// Собирает standalone-версию: одна HTML со вшитыми текстурами (data:URL).
// Такой файл открывается с file:// — для обоев (Lively, Wallpaper Engine) сервер не нужен.
//   node tools/inline.mjs [out.html]
import { readFile, writeFile } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || 'wall.html';

const assets = {};
for (const f of readdirSync(path.join(root, 'assets'))) {
  const p = path.join(root, 'assets', f);
  if (!statSync(p).isFile()) continue;
  const b = await readFile(p);
  const mime = f.endsWith('.png') ? 'image/png' : 'image/jpeg';
  assets['assets/' + f] = `data:${mime};base64,${b.toString('base64')}`;
}

let html = await readFile(path.join(root, 'index.html'), 'utf8');
const inject = `<script>window.__ASSETS=${JSON.stringify(assets)};</script>`;
html = html.replace('<script>', inject + '\n<script>');
await writeFile(path.join(root, out), html);

const mb = (Buffer.byteLength(html) / 1024 / 1024).toFixed(1);
console.log(`${out}: ${mb} MB, ${Object.keys(assets).length} текстур`);
