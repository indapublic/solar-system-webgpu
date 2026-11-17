// node tools/rock-visual.mjs [source.html] [output directory]
// A private test server freezes the date, exposes state and injects test fixtures.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url));
const source=path.resolve(process.argv[2]||path.join(root,'index.html'));
const out=path.resolve(process.argv[3]||path.join(root,'docs/rock-render/after'));
await mkdir(out,{recursive:true});
let testSource=await readFile(source,'utf8');
const variant=process.env.ROCK_VARIANT||'complete';
if(variant==='geometry-only'){
  const start=testSource.indexOf('  let e = 0.002;'),end=testSource.indexOf('  let dist = length(hitW - u.cam.xyz);',start);
  assert.ok(start>0&&end>start);
  testSource=testSource.slice(0,start)+'  let hitW = v.center + rotAxis(rotAxis(p * size, ax1, a1), ax2, a2);\n  let col=vec3f(0.2);\n'+testSource.slice(end);
}
if(variant==='uncached-bulk')testSource=testSource.replaceAll('rockBulkNoise(scaled*1.65+vec3f(seed*53.0),0)','noise3(scaled*1.65+vec3f(seed*53.0))').replaceAll('rockBulkNoise(scaled*3.4+vec3f(seed*97.0),1)','noise3(scaled*3.4+vec3f(seed*97.0))');
const html=testSource
  .replace('window.__ss =','window.__regression=code=>eval(code);\nwindow.__ss =')
  .replace('  updateBodies(dt);','  updateBodies(dt);window.__testScene?.();')
  .replace('adapter.requestDevice()','adapter.requestDevice({requiredFeatures:adapter.features.has("timestamp-query")?["timestamp-query"]:[]})');
const server=createServer(async(req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  if(name==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  if(name==='/favicon.ico'){res.writeHead(204).end();return;}
  try{const file=path.resolve(root,'.'+name);if(!file.startsWith(root))throw Error();res.end(await readFile(file));}
  catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=await mkdtemp(path.join(tmpdir(),'nd-rock-'));
const chrome=spawn(process.env.CHROME||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[
  '--remote-debugging-port=0',`--user-data-dir=${profile}`,'--headless=new','--enable-unsafe-webgpu',
  '--no-first-run','--no-default-browser-check','--disable-renderer-backgrounding',
  '--disable-background-timer-throttling','--window-size=1120,740','about:blank',
],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws;
const results=[],errors=[];
try{
  let port;for(let i=0;i<100;i++){try{port=+(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await sleep(100);}}
  assert.ok(port);const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let id=0;const pending=new Map();
  ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
    if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args);
  };
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
  const inside=code=>evaluate(`__regression(${JSON.stringify(code)})`);
  await send('Runtime.enable');await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1120,height:740,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
  for(let i=0;i<200;i++){if(await evaluate('typeof __regression==="function"'))break;await sleep(100);}
  const gpu=await inside('({vendor:adapter.info.vendor,architecture:adapter.info.architecture,fallback:adapter.info.isFallbackAdapter})');
  console.log('GPU',gpu);
  await writeFile(path.join(out,'metadata.json'),JSON.stringify({gpu,browser:await send('Browser.getVersion'),variant,resolution:[1120,740],samples:7},null,2));
  await inside(`cancelFlight();setSafe(true);releaseTarget();timeSpeed=0;simDays=0;SET.quality='full';scale=1;resize(true);
    SET.bh=false;SET.bloom=0.16;SET.fov=0.65;SET.labels=true;SET.constNames=true;SET.deep=true;SET.exposure=1;
    $('toast').style.display='none';document.body.classList.add('quiet');ui.classList.add('hide');
    window.__fixture=(family,angle=0,distance=3.3,light=0,seedValue=null)=>{
      const g=ROCK_BANDS[0],i=0;const x=4000,y=300,z=0,size=20;
      const shape=rockShape(mulberry32(12871));shape.family=family;shape.seed=seedValue??(family===4?0.58:(family===1?0.12:0.24));
      shape.sx=family===1?1.65:1.08;shape.sy=family===2?0.52:0.83;shape.sz=family===1?0.72:1;
      shape.lobe=family===3?0.7:0;shape.lobeScale=family===3?0.7:1;
      shape.a1=[0,1,0];shape.a2=[0,0,1];shape.ph1=0.45;shape.ph2=0.22;shape.spin=0.03;shape.tumble=0.007;shape.mat=2;
      rockSet(g.data,i,x,y,z,-size,shape);Q.writeBuffer(g.buf,0,g.data.subarray(0,24));
      g.px[i]=x;g.py[i]=y;g.pz[i]=z;g.per[i]=Infinity;
      posX=x-Math.cos(angle+light)*distance*size;posY=y+0.35*size;posZ=z+Math.sin(angle+light)*distance*size;
      velX=velY=velZ=0;lookAt(x,y,z);SET.fov=0.65;
      const forward=[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch)];
      const p=[x+forward[0]*300,y+forward[1]*300,z+forward[2]*300];
      window.__testScene=()=>{
        const j=ALL.length-1,o=j*BODY_STRIDE;ALL[j].pos.splice(0,3,...p);ALL[j].R=2;
        bodyData.set([...p,2],o);bodyData[o+12]=2;bodyData[o+16]=0.4;bodyData[o+17]=0.8;bodyData[o+18]=0.3;
        skyLabelEls[0].d=forward;skyLabelEls[0].el.textContent='Behind asteroid';
      };
      return {shape,cam:__ss(),center:[x,y,z]};
    };
    window.__beltTime=async()=>{
      if(!device.features.has('timestamp-query'))return null;
      const times=[];
      for(let k=0;k<7;k++){
        const query=device.createQuerySet({type:'timestamp',count:2});
        const result=device.createBuffer({size:16,usage:BU.QUERY_RESOLVE|BU.COPY_SRC});
        const read=device.createBuffer({size:16,usage:BU.COPY_DST|BU.MAP_READ});
        const enc=device.createCommandEncoder();
        const pass=enc.beginRenderPass({colorAttachments:[{view:sceneTex.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}],
          depthStencilAttachment:{view:depthTex.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1},
          timestampWrites:{querySet:query,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}});
        pass.setPipeline(pBelt);pass.setBindGroup(0,bgBelt);pass.setVertexBuffer(0,beltBuf);pass.draw(6,BELT_N);pass.end();
        enc.resolveQuerySet(query,0,2,result,0);enc.copyBufferToBuffer(result,0,read,0,16);Q.submit([enc.finish()]);
        await read.mapAsync(GPUMapMode.READ);const data=new BigUint64Array(read.getMappedRange());times.push(Number(data[1]-data[0])/1e6);
        read.unmap();read.destroy();result.destroy();query.destroy();
      }
      window.__beltSamples=times.slice();
      return times.sort((a,b)=>a-b)[3];
    };
    window.__traceAudit=async()=>{
      const modern=BELT.includes('fn traceRock(');
      const legacy=modern?'':
        'struct RockTrace{t:f32,hit:bool,steps:i32,exhausted:bool};'+
        'fn traceRock(ro:vec3f,rd:vec3f,sh:vec3f,fam:f32,seed:f32,lobe:f32,ls:f32,detail:f32,eps:f32)->RockTrace{'+
        'let b=dot(ro,rd);let h=b*b-dot(ro,ro)+1.9*1.9;if(h<0.0){return RockTrace(0.0,false,0,false);}'+
        'let end=-b+sqrt(h);var t=max(0.0,-b-sqrt(h));for(var i=0;i<18;i++){let d=sdRock(ro+rd*t,sh.x,sh.y,sh.z,fam,seed,lobe,ls,detail);'+
        'if(d<0.008){return RockTrace(t,true,i+1,false);}t+=max(d*0.78,0.008);if(t>end){return RockTrace(t,false,i+1,false);}}return RockTrace(t,false,18,true);}';
      const code=BELT+legacy+
        '@group(2) @binding(0) var<storage,read> rock:array<vec4f>;@group(2) @binding(1) var<storage,read_write> output:array<u32>;@group(2) @binding(2) var sceneDepth:texture_depth_2d;'+
        '@compute @workgroup_size(8,8) fn audit(@builtin(global_invocation_id) id:vec3u){if(id.x>=32u||id.y>=24u){return;}'+
        'let pixel=vec2i(vec2f(f32(id.x)/31.0,f32(id.y)/23.0)*(u.res.xy-1.0));'+
        'let uv=(vec2f(pixel)+0.5)/u.res.xy;let ndc=vec2f(uv.x*2.0-1.0,1.0-uv.y*2.0);'+
        'let world=normalize(u.fwd.xyz+u.right.xyz*ndc.x*u.right.w+u.up.xyz*ndc.y*u.up.w);'+
        'let rd=normalize(rotAxis(rotAxis(world,normalize(rock[4].xyz),-rock[5].y),normalize(rock[3].xyz),-rock[5].x));'+
        'let ro=rotAxis(rotAxis(u.cam.xyz-rock[0].xyz,normalize(rock[4].xyz),-rock[5].y),normalize(rock[3].xyz),-rock[5].x)/abs(rock[0].w);'+
        'let sh=rock[2].xyz;let fam=rock[1].z;let seed=rock[1].w;let lobe=rock[5].z;let ls=rock[5].w;'+
        'let actual=traceRock(ro,rd,sh,fam,seed,lobe,ls,1.0,0.001);'+
        'let bound='+ (modern?'rockBound(sh,fam,lobe,ls)':'1.9') +';let b=dot(ro,rd);let h=b*b-dot(ro,ro)+bound*bound;var truth=false;'+
        'if(h>=0.0){var t=max(0.0,-b-sqrt(h));let end=-b+sqrt(h);for(var j=0;j<2048;j++){if(t>end){break;}'+
        'let d=sdRock(ro+rd*t,sh.x,sh.y,sh.z,fam,seed,lobe,ls,1.0);if(d<=0.0){truth=true;break;}t+=0.0025;}}'+
        'let rasterHole=truth&&actual.hit&&textureLoad(sceneDepth,pixel,0)>actual.t*abs(rock[0].w)/400000.0+0.000005;'+
        'output[id.y*32u+id.x]=select(0u,1u,actual.hit)+select(0u,2u,truth)+select(0u,4u,actual.exhausted)+select(0u,8u,rasterHole)+u32(actual.steps)*16u;'+
        (BELT.includes('fn rockBulkNoise(')?'var error=0.0;for(var sample=0;sample<3;sample++){let pos=vec3f(f32(id.x)*3.17-14.0,f32(id.y)*4.13-13.0,f32(sample)*31.7+0.001);error=max(error,abs(rockBulkNoise(pos,sample%2)-noise3(pos)));}output[768u+id.y*32u+id.x]=bitcast<u32>(error);':'output[768u+id.y*32u+id.x]=0u;')+'}';
      const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:device.createShaderModule({code}),entryPoint:'audit'}});
      const output=device.createBuffer({size:6144,usage:BU.STORAGE|BU.COPY_SRC});
      const read=device.createBuffer({size:6144,usage:BU.COPY_DST|BU.MAP_READ});
      const params=device.createBuffer({size:96,usage:BU.STORAGE|BU.COPY_DST});Q.writeBuffer(params,0,beltData.subarray(0,24));
      const entries0=[{binding:0,resource:{buffer:ubo}}];
      const group0=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:entries0});
      const group2=device.createBindGroup({layout:pipeline.getBindGroupLayout(2),entries:[{binding:0,resource:{buffer:params}},{binding:1,resource:{buffer:output}},{binding:2,resource:depthTex.createView()}]});
      const enc=device.createCommandEncoder(),pass=enc.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group0);pass.setBindGroup(2,group2);pass.dispatchWorkgroups(4,3);pass.end();
      enc.copyBufferToBuffer(output,0,read,0,6144);Q.submit([enc.finish()]);await read.mapAsync(GPUMapMode.READ);
      const mapped=read.getMappedRange();
      const values=Array.from(new Uint32Array(mapped,0,768));
      const noiseMaxError=Math.max(...new Float32Array(mapped,3072,768));read.unmap();read.destroy();output.destroy();params.destroy();
      return {holes:values.filter(v=>(v&2)&&!(v&1)).length,rasterHoles:values.filter(v=>v&8).length,exhausted:values.filter(v=>v&4).length,hits:values.filter(v=>v&1).length,meanSteps:values.reduce((a,v)=>a+(v>>4),0)/768,maxSteps:Math.max(...values.map(v=>v>>4)),fallbackRays:values.filter(v=>(v>>4)>128).length,noiseMaxError};
    };
  `);
  for(const view of [
    {name:'angular',fam:0,angle:0.35,d:3.1},{name:'elongated',fam:1,angle:1.4,d:3.6},
    {name:'cratered',fam:4,angle:0.65,d:3.1},{name:'flat',fam:2,angle:0.4,d:3.2},
    {name:'binary',fam:3,angle:0.35,d:3.4},{name:'grazing',fam:1,angle:1.5,d:2.4},
    {name:'shadow',fam:0,angle:3,d:3},{name:'low',fam:1,angle:1.4,d:3.6,low:true},
    {name:'distant',fam:1,angle:1.4,d:900},
  ]){
    if(process.env.ROCK_VIEW_NAMES&&!process.env.ROCK_VIEW_NAMES.split(',').includes(view.name))continue;
    const fixture=await inside(`__fixture(${view.fam},${view.angle},${view.d})`);
    await inside(`SET.quality='${view.low?'low':'full'}';scale=${view.low?0.6:1};resize(true)`);
    await sleep(700);await inside('device.queue.onSubmittedWorkDone()');
    const renderError=await evaluate('document.getElementById("err").textContent');if(renderError)throw Error(renderError.slice(0,2500));
    const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(out,view.name+'.png'),Buffer.from(shot.data,'base64'));
    const audit=await evaluate('__traceAudit()');
    const gpuError=await evaluate('document.getElementById("err").textContent');if(gpuError)throw Error(gpuError.slice(0,2500));
    const gpuMs=await evaluate('__beltTime()');
    const labels=await inside('({body:labelEls.at(-1).classList.contains("on"),sky:skyLabelEls[0].el.style.opacity})');
    results.push({...view,...fixture,gpuMs,gpuSamples:await evaluate('window.__beltSamples'),labels,audit});console.log(view.name,{gpuMs,labels,audit});
    if(html.includes('LABEL_OCCLUSION')){assert.equal(audit.holes,0,view.name+' has no missed solid intersections');assert.equal(audit.rasterHoles,0,view.name+' actual depth covers the surface');}
    assert.ok(audit.noiseMaxError<0.000001,'noise optimization keeps the original field');
  }
  if(process.env.ROCK_SWEEP){
    await inside("SET.quality='full';scale=1;resize(true)");
    for(const fam of [0,1,2,3,4])for(const seed of [0.06,0.24,0.58,0.91]){
      await inside(`__fixture(${fam},${0.25+seed*1.3},3.2,0,${seed})`);await sleep(150);
      const audit=await evaluate('__traceAudit()');results.push({name:`sweep-${fam}-${seed}`,fam,seed,audit});
      console.log('sweep',fam,seed,audit);
      assert.equal(audit.holes,0);assert.equal(audit.rasterHoles,0);assert.ok(audit.noiseMaxError<0.000001);
    }
  }
  if(!process.env.ROCK_SKIP_EXTRAS){
  const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(out,name+'.png'),Buffer.from(r.data,'base64'))};
  const modern=html.includes('LABEL_OCCLUSION');
  await inside(`__fixture(4,0.65,3.1);SET.quality='full';scale=1;resize(true);SET.labels=false;`);
  await sleep(700);await shot('sky-label-behind');
  const skyBehind=await inside('skyLabelEls[0].el.style.opacity');
  if(modern)assert.equal(+skyBehind,0,'constellation label behind asteroid is hidden');
  await inside(`SET.labels=true;const originalFixture=window.__testScene;
    window.__testScene=()=>{originalFixture();const p=[posX+U[12]*12,posY+U[13]*12,posZ+U[14]*12];
      const j=ALL.length-1;ALL[j].pos.splice(0,3,...p);bodyData.set([...p,2],j*BODY_STRIDE);};`);
  await sleep(700);await shot('label-in-front');
  const front=await inside('labelEls.at(-1).classList.contains("on")');
  assert.equal(front,true,'foreground object label remains visible');
  results.push({name:'label-check',skyBehind,front});console.log('labels',{skyBehind,front});
  await inside(`window.__testScene=null;__fixture(1,1.4,3.6);window.__testScene=null;SET.bh=true;
    const c=[BH[0]+2600,BH[1]+500,BH[2]+3400],r=Math.hypot(2600,500,3400);
    beltData.set([...c,-20],0);Q.writeBuffer(beltBuf,0,beltData.subarray(0,24));
    posX=c[0]+2600/r*72;posY=c[1]+500/r*72;posZ=c[2]+3400/r*72;lookAt(...c);`);
  await sleep(700);await shot('black-hole-background');
  assert.equal(await inside('$("bhMark").classList.contains("on")'),true,'navigation marker keeps separate through-obstacle behavior');
  const motion=await inside(`(async()=>{
    SET.bh=false;SET.quality='full';scale=1;resize(true);__fixture(1,0.9,3.8);
    const stream=canvas.captureStream(30),chunks=[];const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:4000000});
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};const stopped=new Promise(r=>recorder.onstop=r);
    const sheet=document.createElement('canvas');sheet.width=1120;sheet.height=1110;const paint=sheet.getContext('2d');let n=0,changed=false;
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));recorder.start();
    await new Promise(resolve=>{const start=performance.now();const tick=now=>{
      const t=Math.min(1,(now-start)/5000);__fixture(1,0.9+t*0.9,3.8-t*1.6);simDays=t*8;
      if(t>0.5&&!changed){SET.quality='low';scale=0.6;resize(true);changed=true;}
      if(n<6&&t>=n/5){paint.drawImage(canvas,(n%2)*560,Math.floor(n/2)*370,560,370);paint.fillStyle='white';paint.font='16px sans-serif';paint.fillText((t*5).toFixed(1)+'s'+(changed?' low':' full'),n%2*560+12,Math.floor(n/2)*370+24);n++;}
      if(t<1)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick)});
    recorder.stop();await stopped;stream.getTracks().forEach(t=>t.stop());
    const video=await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result.split(',')[1]);f.readAsDataURL(new Blob(chunks,{type:'video/webm'}))});
    return {video,contact:sheet.toDataURL('image/png').split(',')[1]};
  })()`);
  await writeFile(path.join(out,'orbit-approach.webm'),Buffer.from(motion.video,'base64'));
  await writeFile(path.join(out,'orbit-approach.png'),Buffer.from(motion.contact,'base64'));
  if(testSource.includes('const limit = 0.98')){
    // A real swept flight along the reviewer-reported empty angular corner.
    // The fixture is held without rotation so the documented local ray is exact.
    const flyby=await inside(`(async()=>{
      SET.bh=false;SET.quality='full';scale=1;resize(true);timeSpeed=0;simDays=0;
      __fixture(0,0,3.1);const g=ROCK_BANDS[0],size=20,x=4000,y=300;
      g.data[15]=g.data[19]=g.data[20]=g.data[21]=0;
      Q.writeBuffer(g.buf,0,g.data.subarray(0,24));clearHazards();rockCool=0;
      const stream=canvas.captureStream(30),chunks=[];
      const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:4000000});
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
      const stopped=new Promise(r=>recorder.onstop=r);
      const sheet=document.createElement('canvas');sheet.width=1120;sheet.height=1110;
      const paint=sheet.getContext('2d');let n=0,frames=0,removed=false,changed=false;
      const debrisBefore=debris.length;posX=x+0.75*size;posY=y+0.65*size;posZ=-3*size;
      lookAt(x,y,0);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));recorder.start();
      await new Promise(resolve=>{const start=performance.now();const tick=now=>{
        const t=Math.min(1,(now-start)/5000),old=[posX,posY,posZ];
        if(t>=0.5&&!changed){SET.quality='low';scale=0.6;resize(true);changed=true;}
        posX=x+0.75*size;posY=y+0.65*size;posZ=(-3+6*t)*size;velX=velY=velZ=0;lookAt(x,y,0);
        rockStep(...old);removed ||= g.data[4]===-2;frames++;
        if(n<6&&t>=n/5){paint.drawImage(canvas,n%2*560,Math.floor(n/2)*370,560,370);paint.fillStyle='white';paint.font='16px sans-serif';paint.fillText('angular corner / '+(t*5).toFixed(1)+'s '+(changed?'low':'full'),n%2*560+12,Math.floor(n/2)*370+24);n++;}
        if(t<1)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick)});
      recorder.stop();await stopped;stream.getTracks().forEach(t=>t.stop());
      const video=await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result.split(',')[1]);f.readAsDataURL(new Blob(chunks,{type:'video/webm'}))});
      return {video,contact:sheet.toDataURL('image/png').split(',')[1],frames,removed,fragments:debris.length-debrisBefore,
        qualitySwitch:'full to low at 2.5s',localPath:[[0.75,0.65,-3],[0.75,0.65,3]],shape:{family:0,seed:0.24,sx:1.08,sy:0.83,sz:1,size}};
    })()`);
    assert.equal(flyby.removed,false,'empty corner flight must not destroy angular');
    assert.equal(flyby.fragments,0,'empty corner flight must not generate debris');
    await writeFile(path.join(out,'angular-flyby.webm'),Buffer.from(flyby.video,'base64'));
    await writeFile(path.join(out,'angular-flyby.png'),Buffer.from(flyby.contact,'base64'));
    const {video,contact,...flightResult}=flyby;results.push({name:'angular-flyby',...flightResult});console.log('angular flyby',flightResult);
  }

  }
  assert.equal(await evaluate('document.getElementById("err").textContent'),'');assert.deepEqual(errors,[]);
  await writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2));
}finally{
  ws?.close();chrome.kill();server.closeAllConnections();server.close();await sleep(1500);
  const target=path.resolve(profile);assert.ok(path.dirname(target)===path.resolve(tmpdir())&&path.basename(target).startsWith('nd-rock-'));
  await rm(target,{recursive:true,force:true,maxRetries:3,retryDelay:500});
}
