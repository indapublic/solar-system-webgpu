// Reproducible Chrome/WebGPU captures. Gas time is fixed only in test responses.
// node tools/bh-visual.mjs [source.html] [output-directory]
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('..', import.meta.url));
const source = path.resolve(process.argv[2] || path.join(root, 'index.html'));
const out = path.resolve(process.argv[3] || path.join(root, 'docs/bh-render/after'));
await mkdir(out, { recursive: true });
const sourceText = await readFile(source, 'utf8');
const probeStart = sourceText.indexOf('function bhOcclusionPoint(');
const probe = sourceText.slice(probeStart, sourceText.indexOf('\n}', probeStart) + 2)
  .replace('function bhOcclusionPoint(', 'function traceProbe(')
  .replaceAll('return { depth: capDepth,', 'return { endR: Math.hypot(px-BH[0],py-BH[1],pz-BH[2]), captured: true, depth: capDepth,')
  .replaceAll('return { depth: diskDepth,', 'return { endR: Math.hypot(px-BH[0],py-BH[1],pz-BH[2]), disk: true, depth: diskDepth,')
  .replace('return { depth: BH_FAR_JS, alpha: 0, L };\n}', 'return { endR: Math.hypot(px-BH[0],py-BH[1],pz-BH[2]), depth: BH_FAR_JS, alpha: 0, L };\n}')
  .replaceAll('endR:', 'escaped: typeof escaped === "undefined" ? null : escaped, endR:');
const html = sourceText
  .replace('window.__ss =', 'window.__regression = code => eval(code);\nwindow.__ss =')
  .replace('U[3] = t;', 'U[3] = 12;')
  .replace('sceneTex = tex(W, H, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);',
    'sceneTex = tex(W, H, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING | TU.COPY_SRC);')
  .replace('  updateBodies(dt);', '  updateBodies(dt); window.__testBodies?.();');
const server = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname;
  if (name === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
  if (name === '/favicon.ico') { res.writeHead(204).end(); return; }
  try {
    const file = path.resolve(root, '.' + name);
    if (!file.startsWith(root)) throw Error('outside root');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const profile = await mkdtemp(path.join(tmpdir(), 'nd-bh-visual-'));
const chrome = spawn(process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--headless=new',
  '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows', '--window-size=1120,740', 'about:blank',
], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws;
const errors = [], results = [];
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = +(await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { await sleep(100); }
  }
  assert.ok(port, 'Chrome starts');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args);
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
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1120, height: 740, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  for (let i = 0; i < 200; i++) { if (await evaluate('typeof __regression === "function"')) break; await sleep(100); }
  await inside(`window.__traceProbe = (${probe});`);
  await inside(`window.__gpuTraceProbe = async () => {
    const baseline = !BH_COMMON.includes('var escaped = false;');
    const budget = baseline ? ((U[23] & 512) ? 84 : 120) : 384;
    const code = BH_COMMON
      .replace('struct BHState', 'var<private> traceStatus: f32 = 0.0; struct BHState')
      .replace('captured = true; capDepth', 'traceStatus = 2.0; captured = true; capDepth')
      .replace('escaped = true;', 'traceStatus = 1.0; escaped = true;')
      .replace('if (!escaped && !captured) {', 'if (!escaped && !captured) { traceStatus = 3.0;')
      .replace('col = min(col, vec3f(2.2));', (baseline ? 'if(!captured){traceStatus=select(3.0,1.0,length(p-C)>BH_R*16.0);}' : '') + 'col = min(col, vec3f(2.2));')
      + '\\nstruct Params { cam:vec4f, right:vec4f, up:vec4f, fwd:vec4f };' 
      + '@group(0) @binding(0) var<uniform> p:Params;'
      + '@group(0) @binding(1) var<storage,read_write> out:array<vec4f>;'
      + '@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u) {'
      + 'if(id.x>=30u || id.y>=20u){return;} let nx=(f32(id.x)/29.0*2.0-1.0)*p.right.w;'
      + 'let ny=(1.0-f32(id.y)/19.0*2.0)*p.up.w;'
      + 'let rd=normalize(p.fwd.xyz+p.right.xyz*nx+p.up.xyz*ny);'
      + 'let s=bhOcclusion(p.cam.xyz,rd,12.0,' + budget + ',' + ((U[23] & 512) ? 2 : 3) + ');'
      + 'out[id.y*30u+id.x]=vec4f(s.depth,s.alpha,traceStatus,' + (baseline ? '1.0' : 'bhMaskRay(p.cam.xyz,rd)') + ');'
      + 'out[600u+id.y*30u+id.x]=vec4f(s.col,1.0); }';
    const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:device.createShaderModule({code}),entryPoint:'main'}});
    const params=device.createBuffer({size:64,usage:BU.UNIFORM|BU.COPY_DST});
    Q.writeBuffer(params,0,U.subarray(0,16));
    const output=device.createBuffer({size:19200,usage:BU.STORAGE|BU.COPY_SRC});
    const read=device.createBuffer({size:19200,usage:BU.COPY_DST|BU.MAP_READ});
    const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:params}},{binding:1,resource:{buffer:output}}]});
    const encoder=device.createCommandEncoder();const pass=encoder.beginComputePass();
    pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(4,3);pass.end();
    encoder.copyBufferToBuffer(output,0,read,0,19200);Q.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const data=Array.from(new Float32Array(read.getMappedRange()));
    read.unmap();params.destroy();output.destroy();read.destroy();
    window.__gpuSamples=data;return data;
  };
  window.__readScenePixel = async (x,y) => {
    const buffer=device.createBuffer({size:256,usage:BU.COPY_DST|BU.MAP_READ});
    const encoder=device.createCommandEncoder();
    encoder.copyTextureToBuffer({texture:sceneTex,origin:[x,y]}, {buffer,bytesPerRow:256}, {width:1,height:1});
    Q.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
    const words=new Uint16Array(buffer.getMappedRange());
    const half = v => ((v & 32768) ? -1 : 1) * ((v >> 10 & 31) ? (1+(v & 1023)/1024)*2**((v >> 10 & 31)-15) : (v & 1023)*2**-24);
    const rgb=Array.from(words.slice(0,3),half);buffer.unmap();buffer.destroy();return rgb;
  };`);
  console.log('GPU:', await inside('({vendor:adapter.info.vendor,architecture:adapter.info.architecture,fallback:adapter.info.isFallbackAdapter})'));
  await inside(`cancelFlight(); setSafe(true); SET.bh = true; timeSpeed = 0; SET.quality = 'full'; scale = 1; resize(true);
    SET.bloom = 0.18; SET.exposure = 1; SET.labels = false; SET.constNames = false; document.body.classList.add('clean'); $('toast').style.display = 'none';`);
  const views = [
    { name: 'center', offset: [2400, 260, 3400], yaw: 0, fov: 0.65 },
    { name: 'edge', offset: [1800, 120, 2400], yaw: 0.48, fov: 0.65 },
    { name: 'reference', offset: [2600, 500, 3400], yaw: -0.5, fov: 0.65 },
    { name: 'above', offset: [2600, 2400, 2000], yaw: 0, fov: 0.65 },
    { name: 'below', offset: [2600, -2400, 2000], yaw: 0, fov: 0.65 },
    { name: 'plane', offset: [2400, 0, 3400], yaw: 0.25, fov: 0.65 },
    { name: 'wide', offset: [2400, 260, 3400], yaw: 0.48, fov: 1.1 },
    { name: 'narrow', offset: [2400, 260, 3400], yaw: -0.5, fov: 0.35 },
    { name: 'portrait', offset: [2600, 500, 3400], yaw: -0.5, fov: 0.65, width: 740, height: 960 },
    { name: 'low', offset: [1800, 120, 2400], yaw: 0.48, fov: 0.65, low: true },
    { name: 'system', offset: [2200, 754, -5846], yaw: 0, fov: 0.65 },
    { name: 'boundary', offset: [5800, 1000, 7600], yaw: -0.35, fov: 0.65 },
  ];
  if (process.env.BH_VIEWS) views.splice(0, views.length, ...JSON.parse(process.env.BH_VIEWS));
  for (const view of views) {
    await send('Emulation.setDeviceMetricsOverride', { width: view.width || 1120, height: view.height || 740, deviceScaleFactor: 1, mobile: false });
    await inside(`cancelFlight(); releaseTarget(); posX = BH[0] + ${view.offset[0]}; posY = BH[1] + ${view.offset[1]}; posZ = BH[2] + ${view.offset[2]};
      velX = velY = velZ = 0; lookAt(...BH); yaw += ${view.yaw}; SET.fov = ${view.fov};
      SET.quality = '${view.low ? 'low' : 'full'}'; scale = ${view.low ? 0.6 : 1}; resize(true);`);
    await sleep(700);
    await inside('device.queue.onSubmittedWorkDone()');
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(out, `${view.name}.png`), Buffer.from(shot.data, 'base64'));
    const state = await inside('({cam:__ss(),perf:__perf(),error:errEl.textContent})');
    const gpu = await evaluate('__gpuTraceProbe()');
    state.trace = await inside(`(() => {
      let unfinished = 0, disk = 0, captured = 0, maxAlphaError = 0;
      for(let y=0;y<20;y++) for(let x=0;x<30;x++) {
        const nx=(x/29*2-1)*U[7], ny=(1-y/19*2)*U[11];
        const d=[U[12]+U[4]*nx+U[8]*ny,U[13]+U[5]*nx+U[9]*ny,U[14]+U[6]*nx+U[10]*ny];
        const l=Math.hypot(...d);
        const s=window.__traceProbe(posX+d[0]/l*200000,posY+d[1]/l*200000,posZ+d[2]/l*200000);
        maxAlphaError=Math.max(maxAlphaError,Math.abs(s.alpha-window.__gpuSamples[(y*30+x)*4+1]));
        if(s.endR && !s.captured && (s.escaped === null ? s.endR <= 16*BH_R_JS : !s.escaped)) unfinished++;
        if(s.disk)disk++; if(s.captured)captured++;
      }
      return {unfinished,disk,captured,maxAlphaError};
    })()`);
    state.gpu = { escaped: 0, captured: 0, unresolved: 0 };
    for (let i = 0; i < 600; i++) {
      const status = gpu[i * 4 + 2];
      if (status === 1) state.gpu.escaped++;
      if (status === 2) state.gpu.captured++;
      if (status === 3) state.gpu.unresolved++;
    }
    assert.equal(state.error, '');
    assert.ok(state.trace.maxAlphaError<0.02, 'CPU labels and GPU use matching opacity');
    results.push({ ...view, ...state }); console.log(view.name, state.trace, state.gpu);
  }
  // Use an actual shaded sphere in front of the shadow, behind it, and behind gas.
  await inside(`cancelFlight(); releaseTarget(); posX=BH[0]+2200;posY=BH[1]+754;posZ=BH[2]-5846;
    lookAt(...BH); SET.fov=0.65; SET.quality='full';scale=1;resize(true);`);
  await sleep(200);
  const pixel = (x, y) => inside(`__readScenePixel(${x},${y})`);
  const snapshot = async name => {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(out, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  const placeSphere = (x, y, distance) => inside(`(() => {
    const nx=(${x}/W*2-1)*U[7],ny=(1-${y}/H*2)*U[11];
    const d=[U[12]+U[4]*nx+U[8]*ny,U[13]+U[5]*nx+U[9]*ny,U[14]+U[6]*nx+U[10]*ny];const l=Math.hypot(...d);
    const p=d.map((v,i)=>U[i]+v/l*${distance});
    window.__testBodies=()=>{const o=(ALL.length-1)*BODY_STRIDE; bodyData.set([...p,${distance}*0.045],o);
      bodyData[o+12]=2;bodyData[o+15]=0;bodyData[o+16]=0.1;bodyData[o+17]=1;bodyData[o+18]=0.2;};
  })()`);
  await placeSphere(560, 370, 1200); await sleep(300); await snapshot('foreground');
  const front = await pixel(560, 370);
  assert.ok(Math.max(...front) > 0.02, 'physical foreground sphere remains visible');
  await placeSphere(560, 370, 20000); await sleep(300); await snapshot('behind-shadow');
  const behind = await pixel(560, 370);
  assert.ok(Math.max(...behind) < 0.002, 'shadow remains opaque over physical sphere');
  const grid = await evaluate('__gpuTraceProbe()');
  let ray = -1;
  for (let i=0;i<600;i++) if(grid[i*4+2]===1 && grid[i*4+1]>0.15 && grid[i*4+1]<0.8) {ray=i;break;}
  assert.ok(ray >= 0, 'find an escaping ray through translucent gas');
  const px = Math.floor((ray%30)/29*1120), py = Math.floor(Math.floor(ray/30)/19*740);
  await placeSphere(px+0.5, py+0.5, 20000); await sleep(300);
  const throughGas = await pixel(px,py); await snapshot('behind-disk');
  await inside('SET.bh=false'); await sleep(200);
  const unobscured = await pixel(px,py); await snapshot('behind-disk-unobscured');
  await inside('SET.bh=true;window.__testBodies=null');
  const weight=grid[ray*4+3], alpha=grid[ray*4+1];
  const expected=unobscured.map((v,i)=>grid[(600+ray)*4+i]*weight+v*(1-alpha*weight));
  const compositionError=Math.max(...expected.map((v,i)=>Math.abs(v-throughGas[i])));
  assert.ok(compositionError<0.02, 'physical sphere behind disk uses the same premultiplied gas and transmission');
  results.push({name:'physical-objects',front,behind,throughGas,unobscured,gasAlpha:alpha,compositionError});
  console.log('physical objects:', results.at(-1));
  for(const motion of ['plane','edge','orbit','boundary']) {
    const video = await inside(`(async () => {
      SET.quality='full';scale=1;resize(true);SET.fov=0.65;
      const stream=canvas.captureStream(30), chunks=[];
      const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:4000000});
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
      const stopped=new Promise(r=>recorder.onstop=r);
      const sheet=document.createElement('canvas');sheet.width=1120;sheet.height=1110;const paint=sheet.getContext('2d');
      const mode=${JSON.stringify(motion)};
      const move=t=>{
        if(mode==='plane'){posX=BH[0]+2400;posY=BH[1]+70*(1-2*t);posZ=BH[2]+3400;lookAt(...BH);yaw+=0.25;}
        if(mode==='edge'){posX=BH[0]+2600;posY=BH[1]+500;posZ=BH[2]+3400;lookAt(...BH);yaw-=0.38+0.24*t;}
        if(mode==='orbit'){const a=t*Math.PI*2;posX=BH[0]+4000*Math.cos(a);posY=BH[1]+1600*Math.sin(a);posZ=BH[2]+4000*Math.sin(a);lookAt(...BH);}
        if(mode==='boundary'){posX=BH[0]+5800;posY=BH[1]+1000;posZ=BH[2]+7600;lookAt(...BH);yaw-=0.2+0.3*t;}
      };
      move(0);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await device.queue.onSubmittedWorkDone();
      let shot=0;const duration=4000;recorder.start();
      await new Promise(resolve=>{
        const start=performance.now();
        const tick=now=>{
          const t=Math.min(1,(now-start)/duration);
          move(t);
          if(shot<6 && t>=shot/5){
            paint.drawImage(canvas,(shot%2)*560,Math.floor(shot/2)*370,560,370);
            paint.fillStyle='white';paint.font='16px sans-serif';paint.fillText(mode+' '+(t*4).toFixed(1)+'s',(shot%2)*560+12,Math.floor(shot/2)*370+24);shot++;
          }
          if(t<1)requestAnimationFrame(tick);else resolve();
        };requestAnimationFrame(tick);
      });
      recorder.stop();await stopped;stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(chunks,{type:'video/webm'});
      const data=await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(blob)});
      return {video:data.split(',')[1],contact:sheet.toDataURL('image/png').split(',')[1]};
    })()`);
    await writeFile(path.join(out, motion+'-motion.webm'),Buffer.from(video.video,'base64'));
    await writeFile(path.join(out, motion+'-motion.png'),Buffer.from(video.contact,'base64'));
    console.log('motion:',motion);
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'views.json'), JSON.stringify(results, null, 2));
  console.log('PASS, captures:', out);
} finally {
  ws?.close(); chrome.kill(); server.closeAllConnections(); server.close();
  await sleep(1500);
  const cleanupPath = path.resolve(profile);
  assert.ok(path.dirname(cleanupPath) === path.resolve(tmpdir()) && path.basename(cleanupPath).startsWith('nd-bh-visual-'));
  await rm(cleanupPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
}
