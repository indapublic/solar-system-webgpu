// Печатает WGSL-константу после подстановки ${NOISE} — так, как её увидит компилятор.
//   node tools/expand.mjs BELT [from] [to]
import { readFile } from 'node:fs/promises';
const [name = 'BELT', from = '1', to = '999'] = process.argv.slice(2);
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const BT = String.fromCharCode(96);
const tpl = (n) => {
  const i = html.indexOf(`const ${n} =`);
  const s = html.indexOf(BT, i) + 1;
  const e = html.indexOf(BT + ';', s);
  return html.slice(s, e);
};
const text = tpl(name).replace('${NOISE}', tpl('NOISE'));
text.split('\n').forEach((l, n) => { if (n + 1 >= +from && n + 1 <= +to) console.log(`${n + 1}: ${l}`); });
