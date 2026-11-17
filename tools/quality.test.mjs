import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fn=name=>{const start=html.indexOf(`function ${name}(`);assert.ok(start>=0);return html.slice(start,html.indexOf('\n}',start)+2);};
function context(mode='auto') {
  const ctx=vm.createContext({SET:{quality:mode,bloom:0.34},LANG:'en',$:()=>null,
    resize:()=>{},scale:0.8,autoQuality:'medium',appliedQuality:null,qualitySlow:0,qualityFast:0});
  const start=html.indexOf('const QUALITY_PROFILES =');
  vm.runInContext(html.slice(start,html.indexOf('\n};',start)+3),ctx);
  for(const name of ['qualityProfile','updateQualityStatus','applyQuality','adaptQuality']) vm.runInContext(fn(name),ctx);
  ctx.applyQuality();return ctx;
}
test('legacy saved modes remain valid and medium has distinct rendering budgets',()=>{
  for(const [mode,scale,dpr,bloom,debris] of [['low',0.6,1,0,84],['medium',0.8,1.5,3,210],['full',1,2,5,420]]) {
    const c=context(mode),p=c.qualityProfile();
    assert.equal(c.SET.quality,mode);assert.equal(c.scale,scale);
    assert.equal(p.dpr,dpr);assert.equal(p.bloomLevels,bloom);assert.equal(p.debris,debris);
  }
  assert.equal(context('obsolete').SET.quality,'auto');
});
test('auto responds to severe foreground overload, respects wallpaper cap and ignores background',()=>{
  const c=context();
  assert.equal(c.adaptQuality(5,60,false),false);
  assert.equal(c.adaptQuality(5,60,false),true);
  assert.equal(c.autoQuality,'low');
  for(let i=0;i<20;i++) c.adaptQuality(1,60,true);
  assert.equal(c.scale,0.6);
  for(let i=0;i<9;i++) assert.equal(c.adaptQuality(30,30,false),false);
  assert.equal(c.adaptQuality(30,30,false),true);
  assert.equal(c.autoQuality,'medium');
});
test('auto has a lower bound and preserves explicit manual choices',()=>{
  const c=context();
  for(let i=0;i<40;i++) c.adaptQuality(5,60,false);
  assert.equal(c.scale,0.5);
  c.SET.quality='full';c.applyQuality();
  for(let i=0;i<20;i++) assert.equal(c.adaptQuality(5,60,false),false);
  assert.equal(c.scale,1);
  c.SET.quality='auto';c.applyQuality();
  assert.equal(c.autoQuality,'medium');assert.equal(c.scale,0.8);
});
test('profile DPR and internal scale both affect actual render allocation',()=>{
  const c=context('full');
  Object.assign(c,{devicePixelRatio:2,canvas:{clientWidth:1000,clientHeight:500},W:1,H:1,DW:1,DH:1,makeTargets:()=>{}});
  vm.runInContext(fn('resize'),c);
  c.resize(false);assert.equal(c.W,2000);assert.equal(c.DW,2000);
  c.SET.quality='medium';c.applyQuality();assert.equal(c.W,1200);assert.equal(c.DW,1500);
  c.SET.quality='low';c.applyQuality();assert.equal(c.W,600);assert.equal(c.DW,1000);
});
test('bloom off dispatches no bloom passes, medium and full populate only their active chains',()=>{
  const start=html.indexOf('  for (let i = 0; i < bloomLevels; i++)');
  const code=html.slice(start,html.indexOf('  r = enc.beginRenderPass({ colorAttachments: [color(ctx.',start));
  for(const [count,expected] of [[0,0],[3,5],[5,9]]) {
    let passes=0;
    const c=vm.createContext({bloomLevels:count,levels:Array.from({length:5},()=>({createView:()=>({})})),
      bgDown:[],bgUp:[],pDown0:0,pDown:1,pUp:2,color:()=>({}),r:null,
      enc:{beginRenderPass:()=>{passes++;return {setPipeline(){},setBindGroup(){},draw(){},end(){}};}}});
    vm.runInContext(code,c);assert.equal(passes,expected);
  }
});
test('disabled bloom sends zero strength after switching from a populated full-quality chain',()=>{
  const c=context('full');
  Object.assign(c,{U:new Float32Array(24),heatU:1});
  const start=html.indexOf('  const renderQuality=qualityProfile();');
  const code=html.slice(start,html.indexOf('\n  U[23]',start));
  const run=()=>vm.runInContext('{'+code+'}',c);
  run();assert.ok(c.U[20]>0);
  c.SET.quality='low';c.applyQuality();run();assert.equal(c.U[20],0);
  c.SET.quality='full';c.SET.bloom=0;c.applyQuality();run();assert.equal(c.U[20],0);
});
test('asteroid debris burst and total population use the active budget',()=>{
  for(const [mode,burst,limit] of [['low',12,84],['medium',21,210],['full',32,420]]) {
    const c=context(mode);
    Object.assign(c,{debris:[],velX:0,velY:0,velZ:0,TAU:Math.PI*2,debrisRnd:()=>0.5,rockShape:()=>({})});
    vm.runInContext(fn('spawnDebris'),c);
    c.spawnDebris(0,0,0,30);assert.equal(c.debris.length,burst);
    for(let i=0;i<50;i++) c.spawnDebris(0,0,0,30);
    assert.equal(c.debris.length,limit);
  }
});
