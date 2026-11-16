// Загружает каталог ярких звёзд и линии созвездий (d3-celestial) и вшивает их в index.html
// между маркерами __STARS_BEGIN / __STARS_END. RA/Dec → эклиптика → мировые оси сцены.
import { readFile, writeFile } from 'node:fs/promises';

const STARS_URL = 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/stars.6.json';
const LINES_URL = 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json';
const NAMES_URL = 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.json';
const EPS = (23.4392911 * Math.PI) / 180;
const RAD = Math.PI / 180;

// RA/Dec (градусы) → мировая единичная ось: эклиптика X,Y в плоскости y = 0, север — +Y
function toWorld(ra, dec) {
  const r = ra * RAD, d = dec * RAD;
  const x = Math.cos(d) * Math.cos(r);
  const y = Math.cos(d) * Math.sin(r);
  const z = Math.sin(d);
  const ye = y * Math.cos(EPS) + z * Math.sin(EPS);
  const ze = -y * Math.sin(EPS) + z * Math.cos(EPS);
  return [x, ze, ye];
}
const f4 = (v) => (Math.round(v * 10000) / 10000).toString();

const sr = await fetch(STARS_URL);
const sj = await sr.json();
const stars = (sj.features || [])
  .filter((f) => f.properties && f.properties.mag <= 3.5)
  .map((f) => {
    const [ra, dec] = f.geometry.coordinates;
    const [x, y, z] = toWorld(ra, dec);
    const bv = Number(f.properties.bv);
    return `${f4(x)},${f4(y)},${f4(z)},${f.properties.mag},${Number.isFinite(bv) ? bv.toFixed(3) : 0.65}`;
  });

const lr = await fetch(LINES_URL);
const lj = await lr.json();
const segs = [];
for (const f of lj.features || []) {
  const g = f.geometry;
  if (!g) continue;
  const lines = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates];
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = toWorld(line[i - 1][0], line[i - 1][1]);
      const b = toWorld(line[i][0], line[i][1]);
      segs.push(`${f4(a[0])},${f4(a[1])},${f4(a[2])},${f4(b[0])},${f4(b[1])},${f4(b[2])}`);
    }
  }
}

// подписи созвездий: точка из constellations.json + названия на двух языках
const nr = await fetch(NAMES_URL);
const nj = await nr.json();
const names = (nj.features || []).map((f) => {
  const [ra, dec] = f.geometry.coordinates;
  const [x, y, z] = toWorld(ra, dec);
  const p = f.properties || {};
  const ru = p.ru || p.name || p.desig || '';
  const en = p.en || p.name || p.desig || '';
  return `${f4(x)},${f4(y)},${f4(z)}|${ru}|${en}`;
});

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const begin = '// __STARS_BEGIN';
const end = '// __STARS_END';
const i = html.indexOf(begin);
const j = html.indexOf(end);
if (i < 0 || j < 0) throw new Error('маркеры __STARS_BEGIN/__STARS_END не найдены');
const block = `${begin}
const STARS_RAW = '${stars.join(';')}';
const CONST_RAW = '${segs.join(';')}';
const CONSTNAME_RAW = ${JSON.stringify(names.join(';'))};
${end}`;
const out = html.slice(0, i) + block + html.slice(j + end.length);
await writeFile(new URL('../index.html', import.meta.url), out);
console.log(`звёзд: ${stars.length}, отрезков созвездий: ${segs.length}, вставлено ${(block.length / 1024).toFixed(1)} КБ`);
