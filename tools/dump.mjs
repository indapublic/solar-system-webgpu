// Печатает строки WGSL-константы из index.html: node tools/dump.mjs BELT [from] [to]
import { readFile } from 'node:fs/promises';
const [name = 'BELT', from = '1', to = '999'] = process.argv.slice(2);
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const key = `const ${name} =`;
const i = html.indexOf(key);
if (i < 0) { console.log('not found'); process.exit(1); }
const s = html.indexOf('`', i) + 1;
const e = html.indexOf('`;', s);
const lines = html.slice(s, e).split('\n');
lines.forEach((l, n) => { if (n + 1 >= +from && n + 1 <= +to) console.log(`${n + 1}: ${l}`); });
