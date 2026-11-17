// GPU shape/coverage regressions: node tools/rock-visual.mjs
// CPU collision bounds and asynchronous label-cache policy:
// node --test tools/rock-render.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fn=name=>{const i=html.indexOf(`function ${name}(`);assert.ok(i>=0);return html.slice(i,html.indexOf('\n}',i)+2)};
test('broad phase covers block corners, not just the longest half-axis',()=>{
  const ctx=vm.createContext({ROCK_STRIDE:24});vm.runInContext(fn('rockRadius'),ctx);
  const data=new Float32Array(24);data[3]=20;data[8]=1.1;data[9]=0.8;data[10]=1;
  const corner=20*Math.hypot(1.1*0.92+0.08,0.8*0.92+0.08,1);
  assert.ok(ctx.rockRadius(data,0)>=corner);
});
test('the connecting neck of a binary is collidable',()=>{
  const ctx=vm.createContext({ROCK_STRIDE:24,simDays:0});vm.runInContext(fn('rotAxisJS')+'\n'+fn('rockHitData'),ctx);
  const data=new Float32Array(24);data[3]=1;data[6]=3;data[8]=0.82;data[9]=0.62;data[10]=0.68;
  data[14]=data[17]=1;data[22]=0.94;data[23]=0.56;
  assert.equal(ctx.rockHitData(data,0,0,0,0,0,0,-0.2,0,0,0.2),true);
  assert.equal(ctx.rockHitData(data,0,0,0,0,0,1,-0.2,0,1,0.2),false);
});
test('label cache requires both target and anchor, keeps foreground, invalidates camera jumps',()=>{
  const ctx=vm.createContext({ALL:[{},{}],W:1120,H:740,posX:0,posY:0,posZ:0,yaw:0,pitch:0,viewTan:0.65,
    labelTravel:0,performance:{now:()=>100},labelPose:{travel:0,x:0,y:0,z:0,yaw:0,pitch:0,fov:0.65,w:1120,h:740,time:95},
    labelVisibility:new Uint32Array([1,0,1,1,0,1]),
  });vm.runInContext(fn('labelDepthVisible'),ctx);
  assert.equal(ctx.labelDepthVisible(0),false,'anchor behind rock hides a floating label');
  assert.equal(ctx.labelDepthVisible(1),true,'foreground target and anchor remain visible');
  assert.equal(ctx.labelDepthVisible(2),false,'constellation occluded');
  assert.equal(ctx.labelDepthVisible(3),true,'unoccluded constellation');
  ctx.posX=540;ctx.labelTravel=540;assert.equal(ctx.labelDepthVisible(1),true,'fast continuous movement keeps labels');
  ctx.posX=1540;assert.equal(ctx.labelDepthVisible(1),false,'stale visibility never survives teleport');
});

function labelContext() {
  const ctx=vm.createContext({ALL:[{}],W:1120,H:740,posX:0,posY:0,posZ:0,yaw:0,pitch:0,viewTan:0.65,
    labelTravel:0,labelGeneration:0,labelFramePosition:null,labelPending:false,
    performance:{now:()=>100},labelPose:{travel:0,x:0,y:0,z:0,yaw:0,pitch:0,fov:0.65,w:1120,h:740,time:95},
    labelVisibility:new Uint32Array([1,1]),GPUMapMode:{READ:1}});
  for(const name of ['invalidateLabelDepth','beginLabelMotion','endLabelMotion','labelDepthVisible','readLabelDepth']) vm.runInContext(fn(name),ctx);
  return ctx;
}

test('whole-frame motion preserves labels during tracking and autopilot with zero velocity',()=>{
  const ctx=labelContext();
  ctx.beginLabelMotion();
  ctx.posX=540; // Orbital following occurs before manual movement.
  ctx.endLabelMotion();
  assert.equal(ctx.labelDepthVisible(0),true);
  ctx.beginLabelMotion();
  ctx.posY=720; // Autopilot and the final target clamp also count.
  ctx.endLabelMotion();
  assert.equal(ctx.labelTravel,1260);
  assert.equal(ctx.labelDepthVisible(0),true);
  ctx.performance.now=()=>346;
  assert.equal(ctx.labelDepthVisible(0),false,'continuous travel does not extend cache lifetime');
});

test('between-frame teleport invalidates cache even when it returns inside accumulated travel',()=>{
  const ctx=labelContext();
  ctx.beginLabelMotion();ctx.posX=540;ctx.endLabelMotion();
  ctx.posX=-460;
  ctx.beginLabelMotion();
  assert.equal(ctx.labelGeneration,1);
  assert.equal(ctx.labelDepthVisible(0),false);
});

test('pending pre-teleport readback cannot resurrect visibility and next readback recovers',async()=>{
  const ctx=labelContext();
  let complete,unmapped=0;
  ctx.labelReadBuf={mapAsync:()=>new Promise(resolve=>{complete=resolve}),
    getMappedRange:()=>new Uint32Array([1,1]).buffer,unmap:()=>unmapped++};
  ctx.labelPending=true;ctx.readLabelDepth();
  ctx.invalidateLabelDepth(); // Includes explicit in-frame jumps such as wallpaper navigation.
  complete();await Promise.resolve();
  assert.equal(ctx.labelPose,null);
  assert.equal(ctx.labelPending,false);
  assert.equal(unmapped,1);
  ctx.labelPending=true;ctx.readLabelDepth();
  complete();await Promise.resolve();
  assert.equal(ctx.labelDepthVisible(0),true);
  assert.equal(unmapped,2);
});

// Construct tangent rays in the convex fragment's transformed coordinates. This
// checks a narrow grazing hit that a fixed set of samples along a fast ray can miss.
test('angular narrow phase keeps tangent and high speed hits, rejects empty corners',()=>{
  const ctx=vm.createContext({ROCK_STRIDE:24,simDays:0});
  vm.runInContext(fn('rotAxisJS')+'\n'+fn('rockHitData'),ctx);
  const data=new Float64Array(24);data[3]=1;data[7]=0.24;data[8]=1.08;data[9]=0.83;data[10]=1;
  data[14]=data[17]=data[23]=1;
  const a=[0.5,0.6,Math.sqrt(0.39)],weights=[0.95,1.10,0.90];
  const limit=0.98+0.045/(0.83*0.9);
  const radius=limit/(0.65+0.35*a.reduce((s,x,k)=>s+x*weights[k],0));
  const gradient=a.map((x,k)=>0.65*x+0.35*weights[k]);
  const tangent=[-gradient[1],gradient[0],0];
  const local=v=>{
    const x=(v[0]-0.12*v[1]-0.0072*v[2])/0.999424,z=v[2]-0.08*x,y=v[1]+0.06*z;
    return [(x+0.04*(0.24-0.5))*1.08,(y-0.025)*0.83,z+0.03];
  };
  for(const size of [0.05,1,30])for(const distance of [2,1e6])for(const offset of [-1e-5,0,1e-5]){
    data[3]=size;
    const endpoint=sign=>local(a.map((x,k)=>x*(radius+offset)+sign*distance*tangent[k])).map(x=>x*size);
    assert.equal(ctx.rockHitData(data,0,0,0,0,...endpoint(-1),...endpoint(1)),offset<=0,
      JSON.stringify({size,distance,offset}));
  }
});
