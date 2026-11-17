import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fn=name=>{const i=html.indexOf(`function ${name}(`);assert.ok(i>=0);return html.slice(i,html.indexOf('\n}',i)+2);};
function collisionContext() {
  const c=vm.createContext({SET:{simpleRocks:true},ROCK_STRIDE:24,simDays:0});
  for(const name of ['rotAxisJS','rockRadius','rockHitData']) vm.runInContext(fn(name),c);
  return c;
}
test('simple collision is the same sphere for every family, including tangent and high-speed segments',()=>{
  const c=collisionContext();
  for(const family of [0,1,2,3]) for(const size of [0.1,1,30,-30]) {
    const d=new Float64Array(24);d[3]=size;d[6]=family;
    d[8]=0.5;d[9]=2;d[10]=0.2;d[12]=d[17]=1;d[22]=1.4;d[23]=0.6;
    const r=Math.abs(size);
    assert.equal(c.rockRadius(d,0),r);
    for(const distance of [2*r,1e6]) {
      assert.equal(c.rockHitData(d,0,10,20,30,10-distance,20+r,30,10+distance,20+r,30),true);
      assert.equal(c.rockHitData(d,0,10,20,30,10-distance,20+r*1.001,30,10+distance,20+r*1.001,30),false);
    }
    assert.equal(c.rockHitData(d,0,10,20,30,10,20,30,10,20,30),true,'stationary point inside');
    assert.equal(c.rockHitData(d,0,10,20,30,10+r*2,20,30,10+r*3,20,30),false,'segment points away');
  }
});
test('switching simple shapes preserves original geometry and destroyed state',()=>{
  const c=collisionContext(),d=new Float64Array(24);
  d[3]=1;d[6]=3;d[8]=0.82;d[9]=0.62;d[10]=0.68;d[14]=d[17]=1;d[22]=0.94;d[23]=0.56;
  const original=Array.from(d);
  c.SET.simpleRocks=false;
  const before=c.rockHitData(d,0,0,0,0,-2,0.7,0,2,0.7,0);
  c.SET.simpleRocks=true;
  assert.equal(c.rockHitData(d,0,0,0,0,-2,0.7,0,2,0.7,0),true);
  c.SET.simpleRocks=false;
  assert.equal(c.rockHitData(d,0,0,0,0,-2,0.7,0,2,0.7,0),before);
  assert.deepEqual(Array.from(d),original);
  d[4]=-2;c.SET.simpleRocks=true;
  assert.equal(c.rockHitData(d,0,0,0,0,-2,0,0,2,0,0),false);
  assert.equal(d[4],-2);
});
test('settings persist the option while missing legacy values remain disabled',()=>{
  let saved='{}';
  const c=vm.createContext({SET:{simpleRocks:false,safe:false,wallTargets:[],wallDwell:45,wallOrbit:0.055,wallFps:30},
    store:{set:(_key,value)=>{saved=value},get:()=>saved},
    clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),sanitizeWallTargets:v=>v,syncSettingsUI:()=>{}});
  vm.runInContext(fn('saveSettings')+'\n'+fn('restoreSettings'),c);
  c.restoreSettings();assert.equal(c.SET.simpleRocks,false);
  c.SET.simpleRocks=true;c.saveSettings();
  assert.equal(JSON.parse(saved).simpleRocks,true);
  c.SET.simpleRocks=false;c.restoreSettings();assert.equal(c.SET.simpleRocks,true);
  saved='{"simpleRocks":"false"}';c.restoreSettings();assert.equal(c.SET.simpleRocks,false);
});
test('checkbox saves its state and invalidates pending label visibility',()=>{
  let callback,invalidated=0,saved=0;
  const control={checked:true,addEventListener:(_name,fn)=>{callback=fn}};
  const c=vm.createContext({SET:{simpleRocks:false},$:()=>control,invalidateLabelDepth:()=>invalidated++,saveSettings:()=>saved++});
  const start=html.indexOf("$('cSimpleRocks').addEventListener");
  vm.runInContext(html.slice(start,html.indexOf('\n});',start)+4),c);
  callback();assert.equal(c.SET.simpleRocks,true);assert.equal(invalidated,1);assert.equal(saved,1);
  control.checked=false;callback();assert.equal(c.SET.simpleRocks,false);assert.equal(invalidated,2);
});
