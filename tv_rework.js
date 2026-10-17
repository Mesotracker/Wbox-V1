'use strict';
// ============================================================
//  3D WORLD REWORK (loaded right after the three.js world view)
//  - exact terrain heights: everything placed on the ground uses the same triangles the GPU draws,
//    so roads, plinths, grass and people no longer float or sink on slopes
//  - solid buildings: oriented-box collision for the player, townsfolk and the third-person camera,
//    double-sided walls, and towns that no longer rebuild (and re-flatten) under your feet
//  - battle damage on intact buildings: broken and boarded windows, soot, charred walls,
//    burnt-out roofs with exposed rafters, collapsed walls and rubble
//  - rivers and lakes as one continuous, flowing surface sitting in carved beds
//  - ground cover: pebbles, boulders, bushes, ferns, logs, stumps, reeds, lily pads, flower meadows
//  - roads as smooth ribbons with verges, lane markings, junctions and bridges; carts, wagons,
//    caravans, cars and trucks travel them between towns
//  - ships with real hulls, sails, funnels, smoke and wakes; harbours with piers, moorings,
//    cranes and lighthouses
//  - a frame-rate governor that also gives quality back, and fewer periodic rebuild hitches
// ============================================================
(function(){
if(typeof TV==='undefined'||typeof FP==='undefined')return;
const Tn=TV.Town,V=TV.Veg,Lf=TV.Life;
const sstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};

// ---------- exact terrain height (matches the terrain mesh's triangle split) ----------
TV.terrH=function(x,z){const H=this.H,n=W.n,st=this.tStep||1,m=this.tM||n;let gx=(x-0.5)/st,gz=(z-0.5)/st;
 if(gx<0)gx=0;else if(gx>m-1.0001)gx=m-1.0001;if(gz<0)gz=0;else if(gz>m-1.0001)gz=m-1.0001;
 const ix=gx|0,iz=gz|0,fx=gx-ix,fz=gz-iz;const xa=Math.min(n-1,ix*st),xb=Math.min(n-1,(ix+1)*st),za=Math.min(n-1,iz*st)*n,zb=Math.min(n-1,(iz+1)*st)*n;
 const a=H[za+xa],b=H[za+xb],c=H[zb+xa],d=H[zb+xb];
 if((ix+iz)&1)return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d+(c-d)*(1-fx)+(b-d)*(1-fz);
 return fx>=fz?a+(b-a)*fx+(d-b)*fz:a+(c-a)*fz+(d-c)*fx;};
const live=()=>FP.three&&TV.H&&TV.world===W&&TV.H.length===W.n*W.n;
// the seabed and lake floors: wet sand in the shallows grading to dark silt, instead of the 2D map's depth blues
{const _ca=TV.colorAt;TV.colorAt=function(i,out,o){const e=W.elev[i];
  // river beds: wet gravel and silt (the 2D map's blue would blend into the banks as purple)
  if(e>=0&&W.isWater(i)&&W.river[i]!==2){const v=0.85+hashI(i*7)*0.3;out[o]=0.2*v;out[o+1]=0.18*v;out[o+2]=0.13*v;return;}
  if(e<0||W.water[i]>0&&W.river[i]===2){const d=e<0?clamp(-e/60,0,1):clamp(W.water[i]/40,0,1);
  const s=[0.27,0.24,0.16],m=[0.07,0.08,0.075];out[o]=s[0]+(m[0]-s[0])*d;out[o+1]=s[1]+(m[1]-s[1])*d;out[o+2]=s[2]+(m[2]-s[2])*d;return;}
  // beaches: dry sand above the waterline, a little darker and browner where it is damp
  if(W.biome[i]===B.BEACH&&W.snow[i]<0.3){const v=0.92+hashI(i*13)*0.16,wet=W.elev[i]<4?0.82:1;out[o]=0.55*v*wet;out[o+1]=0.46*v*wet;out[o+2]=0.27*v*wet*0.95;return;}
  // natural ground colour only: the 2D map tints owned land (and paints borders) in the civilization's colour
  const ow=W.owner[i];if(ow>=0)W.owner[i]=-1;try{return _ca.call(this,i,out,o);}finally{if(ow>=0)W.owner[i]=ow;}};}
{const _ha=FP.heightAt;FP.heightAt=function(x,z){return live()?TV.terrH(x,z):_ha.call(this,x,z);};}

// ---------- terrain normals from the height grid, recomputed only where the simulation changed the ground ----------
// (the engine recomputed normals for the whole map on every fire or lava update, a hitch twice a second)
TV.gridNormals=function(x0,z0,x1,z1){const g=this.terrain&&this.terrain.geometry;if(!g)return;const m=this.tM,st=this.tStep||1,P=g.attributes.position.array,N=g.attributes.normal.array;
 x0=Math.max(0,x0);z0=Math.max(0,z0);x1=Math.min(m-1,x1);z1=Math.min(m-1,z1);
 for(let gz=z0;gz<=z1;gz++)for(let gx=x0;gx<=x1;gx++){const o=gz*m+gx,l=gx>0?o-1:o,r=gx<m-1?o+1:o,d=gz>0?o-m:o,u=gz<m-1?o+m:o;
  const nx=(P[l*3+1]-P[r*3+1])/((gx>0&&gx<m-1?2:1)*st),nz=(P[d*3+1]-P[u*3+1])/((gz>0&&gz<m-1?2:1)*st),il=1/Math.hypot(nx,1,nz);N[o*3]=nx*il;N[o*3+1]=il;N[o*3+2]=nz*il;}
 g.attributes.normal.needsUpdate=true;};
{const _bt=TV.buildTerrain;TV.buildTerrain=function(){_bt.call(this);this.gridNormals(0,0,this.tM-1,this.tM-1);};}
TV.updateTerrain=function(){if(!this.dirty.size||!this.terrain)return;const w=W,n=w.n,st=this.tStep,m=this.tM,g=this.terrain.geometry,A=g.attributes;const pos=A.position.array,col=A.color.array,aw=A.aW.array,sn=A.aSnow.array;
 const ov=R.overlay;R.overlay='terrain';let k=0,bx0=1e9,bz0=1e9,bx1=-1,bz1=-1;
 for(const ci of this.dirty){if(k++>24)break;this.dirty.delete(ci);const ch=w.chunks,cx=ci%ch,cy=ci/ch|0;this.smooth(cx*CH-1,cy*CH-1,cx*CH+CH,cy*CH+CH);
  const x0=Math.max(0,Math.floor((cx*CH-2)/st)),x1=Math.min(m-1,Math.ceil((cx*CH+CH+1)/st)),z0=Math.max(0,Math.floor((cy*CH-2)/st)),z1=Math.min(m-1,Math.ceil((cy*CH+CH+1)/st));
  for(let gz=z0;gz<=z1;gz++)for(let gx=x0;gx<=x1;gx++)this.vert(gx,gz,pos,col,aw,sn);for(let y=cy*CH;y<Math.min(n,cy*CH+CH);y++)for(let x=cx*CH;x<Math.min(n,cx*CH+CH);x++)this.depthTexel(y*n+x);
  bx0=Math.min(bx0,x0);bz0=Math.min(bz0,z0);bx1=Math.max(bx1,x1);bz1=Math.max(bz1,z1);}
 R.overlay=ov;A.position.needsUpdate=true;A.color.needsUpdate=true;A.aW.needsUpdate=true;A.aSnow.needsUpdate=true;if(bx1>=0)this.gridNormals(bx0-1,bz0-1,bx1+1,bz1+1);this.depthTex.needsUpdate=true;this.lastLake=-1e9;};
// ---------- frame-rate governor: steps quality down when slow and back up when there is headroom ----------
TV.govern=function(dt){const g=this.gov||(this.gov={avg:0.016,t:0,lvl:0,good:0});g.avg+=(dt-g.avg)*0.08;g.t+=dt;if(g.t<1.2)return;
 const Q=this.Q;if(!g.base)g.base={pr:Q.pr,clouds:Q.clouds,grass:Q.grass,shadow:Q.shadow};
 if(g.avg>0.034&&g.lvl<4){g.lvl++;g.t=0;g.good=0;this.applyGov();}
 else if(g.avg<0.02&&g.lvl>0){g.good+=g.t;g.t=0;if(g.good>10){g.lvl--;g.good=0;this.applyGov();}}
 else{g.t=0;g.good=0;}};
TV.applyGov=function(){const g=this.gov,b=g.base,Q=this.Q,L=g.lvl;if(!b||!this.r)return;
 Q.pr=L>=4?Math.min(b.pr,0.75):L>=1?Math.min(b.pr,1):b.pr;Q.clouds=L>=4?Math.min(b.clouds,10):L>=2?Math.min(b.clouds,14):L>=1?Math.min(b.clouds,24):b.clouds;Q.grass=L>=3?Math.min(b.grass,8000):b.grass;
 this.r.setPixelRatio(Math.min(Q.pr,devicePixelRatio||1));this.resize();if(this.bloom)this.bloom.enabled=L<2;
 const sm=L>=3?Math.min(1024,b.shadow):b.shadow;if(this.sun.shadow.mapSize.x!==sm){this.sun.shadow.mapSize.set(sm,sm);if(this.sun.shadow.map){this.sun.shadow.map.dispose();this.sun.shadow.map=null;}}
 if(this.Veg)this.Veg.lastG=null;};
// hand back anything the governor took before settings are changed or a new view starts
TV.resetGov=function(){const g=this.gov;if(g&&g.base&&g.lvl>0){g.lvl=0;this.applyGov();}this.gov=null;};
{const _b=TV.begin;TV.begin=function(){this.resetGov();this._wl=null;return _b.apply(this,arguments);};}
// effect lights stay in the scene permanently (dark when idle): toggling them changed the scene's light count,
// which made three.js recompile every material in the world mid-game (half-second freezes on explosions and fires)
{const _fi=TV.FX3.init;TV.FX3.init=function(tv){_fi.call(this,tv);for(const l of this.lights){const L=l.L;L.intensity=0;Object.defineProperty(L,'visible',{get(){return true;},set(v){if(!v)L.intensity=0;},configurable:true});}};}
// compile every shader up front (on entering the 3D view and once the first towns are built) instead of on first sight
TV.warm=function(){try{this.r.compile(this.scene,this.cam);}catch(e){}};
{const _b2=TV.begin;TV.begin=function(){const r=_b2.apply(this,arguments);this.warm();this._warmed=false;return r;};
 const _rf=TV.refresh;TV.refresh=function(){const r=_rf.apply(this,arguments);if(!this._warmed&&this.Town.cities.size){this._warmed=true;this.warm();}return r;};}
if(typeof VIEW3D!=='undefined'){for(const k of ['applyQ','exit']){const f=VIEW3D[k];if(f)VIEW3D[k]=function(){TV.resetGov();return f.apply(this,arguments);};}}

// ============================================================
//  BUILDINGS: collision shapes, damage, solid walls
// ============================================================
// every ground-level box, cylinder and cone a building is made of becomes a collision shape (local metres)
{const P=TVBd.prototype,_box=P.box,_cyl=P.cyl,_cone=P.cone,_q=P.q;
 P.box=function(k,cx,cz,y0,w,d,h,col,o){_box.call(this,k,cx,cz,y0,w,d,h,col,o);if(!this.noCol&&y0<1.3&&y0+h>0.95&&w>0.1&&d>0.1)(this.cols||(this.cols=[])).push([0,cx,cz,w/2,d/2,(o&&o.a)||0,y0+h]);};
 P.cyl=function(k,cx,cz,y0,r,h,seg,col,o){_cyl.call(this,k,cx,cz,y0,r,h,seg,col,o);if(!this.noCol&&y0<1.3&&y0+h>0.95&&r>0.05)(this.cols||(this.cols=[])).push([1,cx,cz,r]);};
 P.cone=function(k,cx,cz,y0,r,h,seg,col,o){_cone.call(this,k,cx,cz,y0,r,h,seg,col,o);if(!this.noCol&&y0<0.5&&y0+h>1.6&&r>0.3)(this.cols||(this.cols=[])).push([1,cx,cz,r*Math.max(0.3,1-(1-y0)/h)]);};
 // remember every quad so damage can later break, recolour or remove it
 P.q=function(k,pts,hint,col,sh,uv){const gb=this.g(k),i0=gb.i.length,v0=gb.v;_q.call(this,k,pts,hint,col,sh,uv);if(gb.i.length>i0)(this.ql||(this.ql=[])).push({k,i0,v0,pts,hint});};
 // a square-section beam between two local points (rafters, fallen timbers)
 P.beam=function(k,A,Bp,wd,col){const ux=Bp[0]-A[0],uy=Bp[1]-A[1],uz=Bp[2]-A[2],L=Math.hypot(ux,uy,uz);if(L<0.05)return;let sx=-uz,sz=ux;const sl=Math.hypot(sx,sz);if(sl<1e-6){sx=1;sz=0;}else{sx/=sl;sz/=sl;}
  const vx=sz*uy/L-0,vy=(sx*uz-sz*ux)/L,vz=-sx*uy/L;const vl=Math.hypot(vx,vy,vz)||1;const h=wd/2;const S=[sx*h,0,sz*h],U=[vx/vl*h,vy/vl*h,vz/vl*h];
  const p=(o,s,u)=>[o[0]+S[0]*s+U[0]*u,o[1]+S[1]*s+U[1]*u,o[2]+S[2]*s+U[2]*u];
  for(const [s0,u0,s1,u1,hn] of [[1,1,1,-1,S],[-1,-1,-1,1,S.map(v=>-v)],[1,1,-1,1,U],[-1,-1,1,-1,U.map(v=>-v)]])this.q(k,[p(A,s0,u0),p(A,s1,u1),p(Bp,s1,u1),p(Bp,s0,u0)],hn,col);};}
// tag each building with its kind and context so damage knows what it is looking at
for(const k in Tn.A){const f=Tn.A[k];Tn.A[k]=function(o,x){o.kind=k;o.ctx=x;return f.call(this,o,x);};}

const ROOFK=new Set(['thatch','tile','slate','shingle','metal','copper']);
const WINK=new Set(['window','lit']);
const TRIMK=new Set(['window','lit','frame','shutter','door','char','soot','glow']);
const NODMG=new Set(['market','campfire','well','tent','totem']);
const RUBK=new Set(['stone','brick','plaster','mud','wattle','concrete','timber','siding','marble']);
// how badly this building is damaged: battle damage of the town, plus everyday wear and the odd derelict house
TV.dmgLevel=function(o){const x=o.ctx,c=x.c;if(NODMG.has(o.kind))return 0;const cd=c.damage||0,r1=hashI(o.seed*17+3),r2=hashI(o.seed*13+5),r3=hashI(o.seed*7+1);let lvl=0;
 if(cd>0.02)lvl=clamp(cd*1.7*(0.25+r1*1.1),0,1);
 if(lvl<0.12){if(r2<0.14)lvl=0.1+r3*0.22;else if(r2<0.14+(x.era<=6?0.05:0.03))lvl=0.42+r3*0.26;}
 if(c.state!=='alive')lvl=Math.max(lvl,0.55);return lvl;};
TV.damage=function(o){if(o.kind==='ruin'){this.ruinExtras(o);return;}const lvl=this.dmgLevel(o);if(lvl<=0.05||!o.ql)return;
 const R=tvRnd(o.seed*31+11),G=o.G,pal=o.pal,ql=o.ql;
 const kill=(q)=>{const I=G[q.k].i;for(let t=0;t<6;t++)I[q.i0+t]=q.v0;q.dead=true;};
 const toK=(q,k2)=>{const s=G[q.k],d=o.g(k2),b=d.v;for(let j=0;j<4;j++){const v=q.v0+j;d.vert(s.p[v*3],s.p[v*3+1],s.p[v*3+2],s.n[v*3],s.n[v*3+1],s.n[v*3+2],s.u[v*2],s.u[v*2+1],[s.c[v*3]*0.35,s.c[v*3+1]*0.33,s.c[v*3+2]*0.3]);}d.quad(b,b+1,b+2,b+3);kill(q);};
 const cen=(q)=>{const p=q.pts;return [(p[0][0]+p[2][0])/2,(p[0][1]+p[2][1])/2,(p[0][2]+p[2][2])/2];};
 const nrm=(q)=>{const h=q.hint,l=Math.hypot(h[0],h[2])||1;return [h[0]/l,h[2]/l];};
 const walls=ql.filter(q=>!TRIMK.has(q.k)&&!ROOFK.has(q.k)&&Math.abs(q.hint[1])<0.01&&q.k!=='dark');
 let yTop=0,yBase=1e9;for(const q of walls)for(const p of q.pts){if(p[1]>yTop)yTop=p[1];if(p[1]<yBase)yBase=p[1];}if(!walls.length)return;yBase=Math.max(0,yBase);
 // the main wall material and colour feed the rubble
 let big=walls[0],ba=0;for(const q of walls){const p=q.pts,a=Math.hypot(p[1][0]-p[0][0],p[1][2]-p[0][2])*Math.abs(p[3][1]-p[0][1]);if(a>ba&&p[0][1]<1){ba=a;big=q;}}
 const wk=RUBK.has(big.k)?big.k:'stone',sc=G[big.k].c,wcol=[sc[big.v0*3+2*3+0]||0.8,sc[big.v0*3+2*3+1]||0.8,sc[big.v0*3+2*3+2]||0.8];
 // 1. windows: broken (dark), burnt out, or boarded up; soot climbs the wall above the worst
 for(const q of ql){if(!WINK.has(q.k)||q.dead)continue;const pb=lvl<0.15?0.28:Math.min(0.95,lvl*1.4);if(R()>pb)continue;const c=cen(q),[nx,nz]=nrm(q),p=q.pts;
  const ww=Math.hypot(p[1][0]-p[0][0],p[1][2]-p[0][2]),wh=Math.abs(p[3][1]-p[0][1]);
  if(lvl<0.45&&R()<0.45){const ang=Math.atan2(-nx,nz);o.noCol=true;for(const dy of [-wh*0.22,wh*0.18])o.box('plank',c[0]+nx*0.06,c[2]+nz*0.06,c[1]+dy,ww+0.25,0.05,0.14,pal.wood,{a:ang+(R()-0.5)*0.0});o.noCol=false;}
  else toK(q,'char');
  if(lvl>0.28&&R()<0.75){const tx=nz,tz=-nx,top=Math.max(p[2][1],p[3][1]),hw=ww/2+0.2+R()*0.3,hh=1.0+lvl*1.6*(0.6+R()*0.6),off=0.052-0.04;const b=[c[0]+nx*off,c[2]+nz*off];
   o.q('soot',[[b[0]-tx*hw,top-0.08,b[1]-tz*hw],[b[0]+tx*hw,top-0.08,b[1]+tz*hw],[b[0]+tx*hw,top+hh,b[1]+tz*hw],[b[0]-tx*hw,top+hh,b[1]-tz*hw]],[nx,0,nz],[1,1,1],null,[0,0,1,1]);}}
 // shell holes and blown-out panes on large plain facades (modern towers have their windows in the texture)
 if(lvl>0.3)for(const q of walls){const p=q.pts,ww=Math.hypot(p[1][0]-p[0][0],p[1][2]-p[0][2]),wh=Math.abs(p[3][1]-p[0][1]);if(ww*wh<30)continue;const nh=Math.floor(ww*wh/45*lvl*(0.5+R()));const [nx,nz]=nrm(q),tx=(p[1][0]-p[0][0])/ww,tz=(p[1][2]-p[0][2])/ww;
  for(let k=0;k<Math.min(nh,14);k++){const s=0.6+R()*(ww-1.2),y=p[0][1]+1.2+R()*(wh-2.4),hw=0.7+R()*0.9,hh=0.6+R()*0.8;const bx=p[0][0]+tx*s+nx*0.03,bz=p[0][2]+tz*s+nz*0.03;
   o.q('char',[[bx-tx*hw,y-hh,bz-tz*hw],[bx+tx*hw,y-hh,bz+tz*hw],[bx+tx*hw*0.8,y+hh,bz+tz*hw*0.8],[bx-tx*hw*1.1,y+hh*0.9,bz-tz*hw*1.1]],[nx,0,nz],[0.3,0.28,0.26]);
   if(R()<0.6)o.q('soot',[[bx-tx*(hw+0.4),y+hh-0.1,bz-tz*(hw+0.4)],[bx+tx*(hw+0.4),y+hh-0.1,bz+tz*(hw+0.4)],[bx+tx*(hw+0.4),y+hh+1.8,bz+tz*(hw+0.4)],[bx-tx*(hw+0.4),y+hh+1.8,bz-tz*(hw+0.4)]].map(v=>[v[0]+nx*0.01,v[1],v[2]+nz*0.01]),[nx,0,nz],[1,1,1],null,[0,0,1,1]);}}
 // 2. fire-blackened upper walls and roofs
 if(lvl>0.22){const yb=yBase+(yTop-yBase)*(0.1+R()*0.45);for(const q of ql){if(q.dead||TRIMK.has(q.k))continue;const s=G[q.k],roof=ROOFK.has(q.k);
   for(let j=0;j<4;j++){const v=q.v0+j,y=s.p[v*3+1]/UM;const f=roof?1-lvl*0.55:1-lvl*0.75*sstep(yb,yTop+0.5,y);s.c[v*3]*=f;s.c[v*3+1]*=f*0.97;s.c[v*3+2]*=f*0.94;}}}
 // 3. burnt-out roofs: one slope gone, or the whole roof on gutted buildings, with charred rafters left standing
 const roofs=ql.filter(q=>ROOFK.has(q.k)&&q.hint[1]>0&&!q.dead);
 if(lvl>0.4&&roofs.length){const all=lvl>0.7;const pick=all?roofs:[roofs[(R()*roofs.length)|0]];const ch=[0.09,0.075,0.06];
  for(const q of pick){kill(q);const p=q.pts,eL=Math.hypot(p[1][0]-p[0][0],p[1][2]-p[0][2]);const nr=Math.max(2,Math.round(eL/0.75));
   for(let k=0;k<=nr;k++){const t=(k+0.2)/(nr+0.4);if(R()<0.22)continue;const E=[p[0][0]+(p[1][0]-p[0][0])*t,p[0][1]+(p[1][1]-p[0][1])*t,p[0][2]+(p[1][2]-p[0][2])*t],Rg=[p[3][0]+(p[2][0]-p[3][0])*t,p[3][1]+(p[2][1]-p[3][1])*t,p[3][2]+(p[2][2]-p[3][2])*t];
    const f=R()<0.35?0.35+R()*0.5:1;o.beam('char',E,[E[0]+(Rg[0]-E[0])*f,E[1]+(Rg[1]-E[1])*f,E[2]+(Rg[2]-E[2])*f],0.16,ch);}
   if(R()<0.6)o.beam('char',p[3],[p[3][0]+(p[2][0]-p[3][0])*(0.4+R()*0.6),p[3][1]+(p[2][1]-p[3][1])*0.5,p[3][2]+(p[2][2]-p[3][2])*(0.4+R()*0.6)],0.2,ch);}
  o.stacks.length=0;
  const cd=o.ctx.c.damage||0;if(cd>0.25&&R()<0.3&&(o.ctx.c._fires||[]).length<5){const q=pick[0],c=cen(q);o.fires.push(o.P(c[0]*0.6,yTop*0.7,c[2]*0.6));}}
 // 4. collapsed walls on the worst hit: the wall breaks into a jagged stump and its windows and trim go with it
 if(lvl>0.68){const cand=walls.filter(q=>{const p=q.pts;return !q.dead&&p[0][1]<1&&Math.hypot(p[1][0]-p[0][0],p[1][2]-p[0][2])>2.5;});const nw=Math.min(cand.length,lvl>0.85?2:1);
  for(let w=0;w<nw;w++){const q=cand.splice((R()*cand.length)|0,1)[0];if(!q)break;kill(q);const p=q.pts,[nx,nz]=nrm(q),y0=p[0][1],y1=Math.max(p[2][1],p[3][1]),m=5+((R()*4)|0);const s=G[q.k],col=[s.c[q.v0*3],s.c[q.v0*3+1],s.c[q.v0*3+2]];
   const jag=[];for(let j=0;j<=m;j++){const e=Math.abs(j/m-0.5)*2;jag.push(y0+(y1-y0)*Math.min(0.95,0.08+R()*0.35+e*e*0.55));}
   for(let j=0;j<m;j++){const ta=j/m,tb=(j+1)/m,A=[p[0][0]+(p[1][0]-p[0][0])*ta,p[0][2]+(p[1][2]-p[0][2])*ta],Bp=[p[0][0]+(p[1][0]-p[0][0])*tb,p[0][2]+(p[1][2]-p[0][2])*tb];
    o.q(q.k,[[A[0],y0,A[1]],[Bp[0],y0,Bp[1]],[Bp[0],jag[j+1],Bp[1]],[A[0],jag[j],A[1]]],q.hint,col,[0.8,0.8,0.7,0.7]);}
   // drop anything mounted on that wall above the break (windows, frames, sills, bands, boards, soot)
   const L2=Math.hypot(p[1][0]-p[0][0],p[1][2]-p[0][2]),tx=(p[1][0]-p[0][0])/L2,tz=(p[1][2]-p[0][2])/L2;
   for(const r of o.ql){if(r.dead||r===q||ROOFK.has(r.k))continue;const c=cen(r),dx=c[0]-p[0][0],dz=c[2]-p[0][2],dn=dx*nx+dz*nz,dt=dx*tx+dz*tz;if(Math.abs(dn)>0.4||dt<-0.2||dt>L2+0.2)continue;const jy=jag[clamp(Math.round(dt/L2*m),0,m)];if(c[1]>jy+0.05)kill(r);}
   // a heap of the fallen wall in front of it
   o.noCol=true;const mx=(p[0][0]+p[1][0])/2,mz=(p[0][2]+p[1][2])/2;for(let k=0;k<10+lvl*10;k++){const s2=(R()-0.5)*L2,o2=0.2+R()*2.2,sz=0.25+R()*0.65;o.box(RUBK.has(q.k)?q.k:wk,mx+tx*s2+nx*o2,mz+tz*s2+nz*o2,-0.08,sz,sz*(0.6+R()*0.6),sz*(0.4+R()*0.7)*(1.6-o2/2.4),col.map(v=>v*0.8),{a:R()*3});}
   for(let k=0;k<3;k++){const a=[mx+tx*(R()-0.5)*L2+nx*(0.3+R()),0.05+R()*0.3,mz+tz*(R()-0.5)*L2+nz*(0.3+R())];o.beam('char',a,[a[0]+(R()-0.5)*3,0.05,a[2]+(R()-0.5)*3],0.18,[0.12,0.1,0.08]);}o.noCol=false;}}
 // 5. rubble and debris around the base; more and bigger the worse the damage
 {o.noCol=true;const hw=o.fw/2,hd=o.fd/2,nr=Math.round(2+lvl*16);for(let k=0;k<nr;k++){const side=(R()*4)|0,t=(R()-0.5)*2,off=0.15+R()*1.4;let x,z;if(side===0){x=t*hw;z=hd+off;}else if(side===1){x=t*hw;z=-hd-off;}else if(side===2){x=hw+off;z=t*hd;}else{x=-hw-off;z=t*hd;}
   const sz=(0.12+R()*0.35)*(0.6+lvl*0.9);o.box(wk,x,z,-0.06,sz,sz*(0.5+R()*0.8),sz*(0.35+R()*0.5),wcol.map(v=>v*(0.7+R()*0.25)),{a:R()*3});}
  if(lvl>0.3)for(let k=0;k<Math.round(lvl*4);k++){const a=[(R()-0.5)*(o.fw+2),0.04,(R()-0.5)*2+(R()<0.5?hd+0.6:-hd-0.6)];o.beam(R()<0.5?'char':'wood',a,[a[0]+(R()-0.5)*2.6,0.05+R()*0.25,a[2]+(R()-0.5)*1.2],0.14,R()<0.5?[0.12,0.1,0.08]:pal.wood);}
  o.noCol=false;}};
// ruins get jagged wall tops, rubble mounds, fallen timbers and soot
TV.ruinExtras=function(o){const R=tvRnd(o.seed*29+5),pal=o.pal;o.noCol=true;const col=[0.62,0.58,0.54];
 for(const s of (o.cols||[]).slice()){if(s[0])continue;const L=Math.max(s[3],s[4])*2,along=s[3]>=s[4],ca=Math.cos(s[5]),sa=Math.sin(s[5]),top=s[6]||1;const n=Math.max(2,Math.round(L/0.9));
  for(let k=0;k<n;k++){if(R()<0.35)continue;const t=(k+0.5)/n-0.5,lx=along?t*L:0,lz=along?0:t*L;const x=s[1]+lx*ca-lz*sa,z=s[2]+lx*sa+lz*ca,h=0.15+R()*0.9;
   o.box('stone',x,z,top,along?L/n*0.95:s[3]*2,along?s[4]*2:L/n*0.95,h,col.map(v=>v*(0.85+R()*0.3)),{a:s[5]});}}
 for(let k=0;k<6;k++){const cx=(R()-0.5)*o.fw,cz=(R()-0.5)*o.fd;for(let j=0;j<4;j++){const sz=0.8-j*0.16+R()*0.3;o.box('stone',cx+(R()-0.5)*0.6,cz+(R()-0.5)*0.6,-0.1+j*0.18,sz,sz*(0.7+R()*0.5),0.3,col.map(v=>v*(0.7+R()*0.3)),{a:R()*3});}}
 for(let k=0;k<4;k++){const a=[(R()-0.5)*o.fw,0.05,(R()-0.5)*o.fd];o.beam('char',a,[a[0]+(R()-0.5)*3,0.4+R()*1.6,a[2]+(R()-0.5)*3],0.18,[0.11,0.09,0.07]);}
 o.noCol=false;};

// double-sided walls (nothing goes see-through from inside or up close), soot decals, road and verge materials
{const _ib=Tn.initB;Tn.initB=function(tv){_ib.call(this,tv);const T=tv.T;
  for(const k in this.B){const m=this.B[k];if(k==='glow')continue;m.side=T.DoubleSide;m.shadowSide=T.BackSide;}
  for(const k in this.m){const m=this.m[k];m.side=T.DoubleSide;m.shadowSide=T.BackSide;}
  const soot=tv.ctex('soot',128,256,(c,w,h)=>{c.clearRect(0,0,w,h);const r=tvRnd(77);for(let k=0;k<70;k++){const x=w*(0.15+r()*0.7),y0=h*(0.75+r()*0.25),y1=h*(0.05+r()*0.5),wd=10+r()*26;const g=c.createLinearGradient(0,y0,0,y1);g.addColorStop(0,'rgba(14,11,9,0.32)');g.addColorStop(1,'rgba(14,11,9,0)');c.fillStyle=g;c.beginPath();c.ellipse(x,(y0+y1)/2,wd/2,(y0-y1)/2,0,0,6.283);c.fill();}},{clamp:true});
  this.B.soot=new T.MeshStandardMaterial({map:soot,transparent:true,depthWrite:false,vertexColors:true,roughness:1,side:T.DoubleSide});
  const tx=this.tx;const RM=(map,o)=>new T.MeshStandardMaterial(Object.assign({map,roughness:0.95,metalness:0,side:T.DoubleSide,vertexColors:true},o));
  const verge=tv.ctex('verge',64,64,(c,w,h)=>{const id=c.createImageData(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=y/(h-1),j=(hashI(x*31+((y/4)|0)*7)-0.5)*0.35;const a=clamp(1-Math.pow(clamp(v+j*v,0,1),0.8),0,1);const i=(y*w+x)*4;id.data[i]=id.data[i+1]=id.data[i+2]=a*255;id.data[i+3]=255;}c.putImageData(id,0,0);},{data:true});
  verge.channel=1;verge.wrapT=T.ClampToEdgeWrapping;verge.needsUpdate=true;
  // road surfaces drawn at real scale: granite setts in staggered courses, fine-grained asphalt with patches and cracks, packed dirt with pebbles
  const setts=tv.ctex('setts',512,512,(c,w,h)=>{c.fillStyle='#3a3630';c.fillRect(0,0,w,h);const r=tvRnd(61),rows=22,rh=h/rows;for(let y=0;y<rows;y++){let x=-r()*20;while(x<w){const sw=16+r()*14,l=95+r()*70,t=r()*14-7;c.fillStyle=`rgb(${l+t|0},${l*0.96|0},${l*0.9-t|0})`;
     const x0=x+1.6,y0=y*rh+1.6,ww=Math.min(sw,w-x)-3.2,hh=rh-3.2,rr=4;if(ww>2){c.beginPath();c.moveTo(x0+rr,y0);c.lineTo(x0+ww-rr,y0);c.quadraticCurveTo(x0+ww,y0,x0+ww,y0+rr);c.lineTo(x0+ww,y0+hh-rr);c.quadraticCurveTo(x0+ww,y0+hh,x0+ww-rr,y0+hh);c.lineTo(x0+rr,y0+hh);c.quadraticCurveTo(x0,y0+hh,x0,y0+hh-rr);c.lineTo(x0,y0+rr);c.quadraticCurveTo(x0,y0,x0+rr,y0);c.fill();
      c.fillStyle='rgba(255,250,240,0.12)';c.fillRect(x0+2,y0+1,ww-4,2);c.fillStyle='rgba(0,0,0,0.2)';c.fillRect(x0+2,y0+hh-3,ww-4,2);}x+=sw;}}
    for(let k=0;k<5000;k++){c.fillStyle=r()<0.5?'rgba(0,0,0,0.12)':'rgba(255,255,255,0.08)';c.fillRect(r()*w,r()*h,1+r()*2,1+r()*2);}
    for(let k=0;k<40;k++){const x=r()*w,y=r()*h,rad=20+r()*60;const g=c.createRadialGradient(x,y,0,x,y,rad);g.addColorStop(0,'rgba(40,36,28,0.18)');g.addColorStop(1,'rgba(40,36,28,0)');c.fillStyle=g;c.fillRect(x-rad,y-rad,rad*2,rad*2);}});
  const asph=tv.ctex('asph2',512,512,(c,w,h)=>{c.fillStyle='#46464a';c.fillRect(0,0,w,h);const r=tvRnd(63);for(let k=0;k<26000;k++){const l=40+r()*60|0;c.fillStyle=`rgba(${l},${l},${l+4},0.55)`;c.fillRect(r()*w,r()*h,1+r()*1.5,1+r()*1.5);}
    for(let k=0;k<14;k++){const x=r()*w,y=r()*h,pw=30+r()*90,ph=20+r()*60;c.fillStyle=`rgba(${30+r()*20|0},${30+r()*20|0},${34+r()*20|0},0.35)`;c.fillRect(x,y,pw,ph);}
    c.strokeStyle='rgba(20,20,22,0.55)';c.lineWidth=1.2;for(let k=0;k<22;k++){let x=r()*w,y=r()*h;c.beginPath();c.moveTo(x,y);for(let j=0;j<6;j++){x+=(r()-0.5)*40;y+=(r()-0.5)*40;c.lineTo(x,y);}c.stroke();}});
  const dirt2=tv.ctex('dirt2',512,512,(c,w,h)=>{c.fillStyle='#86704f';c.fillRect(0,0,w,h);const r=tvRnd(65);for(let k=0;k<60;k++){const x=r()*w,y=r()*h,rad=30+r()*90;const g=c.createRadialGradient(x,y,0,x,y,rad);const d=r()<0.5;g.addColorStop(0,d?'rgba(70,54,36,0.35)':'rgba(176,150,110,0.3)');g.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=g;c.fillRect(x-rad,y-rad,rad*2,rad*2);}
    for(let k=0;k<2600;k++){const x=r()*w,y=r()*h,s=1+r()*r()*5,l=90+r()*110|0;c.fillStyle='rgba(30,22,14,0.5)';c.beginPath();c.ellipse(x+s*0.3,y+s*0.3,s,s*0.8,0,0,6.283);c.fill();c.fillStyle=`rgb(${l},${l*0.9|0},${l*0.75|0})`;c.beginPath();c.ellipse(x,y,s,s*0.8,r()*3,0,6.283);c.fill();}
    for(let k=0;k<9000;k++){c.fillStyle=r()<0.5?'rgba(60,46,30,0.4)':'rgba(190,165,125,0.3)';c.fillRect(r()*w,r()*h,1+r()*2,1+r()*2);}});
  this.rm={dirt:RM(dirt2),cobble:RM(setts,{roughness:0.88}),asphalt:RM(asph,{roughness:0.85}),paint:new T.MeshStandardMaterial({vertexColors:true,roughness:0.6,side:T.DoubleSide}),
   verge:new T.MeshStandardMaterial({map:dirt2,alphaMap:verge,transparent:true,depthWrite:false,vertexColors:true,roughness:1,side:T.DoubleSide})};};}

// collision shapes and harbour decks are gathered while a town is built
{const _mb=Tn.mergeB;Tn.mergeB=function(dstB,dstO,o,ox,oy,oz,co,si){
  if(o.ctx&&o.kind)try{TV.damage(o);}catch(e){console.warn('damage',o.kind,e);}
  if(this._col&&o.cols){const th=Math.atan2(si,co);for(const s of o.cols){const X=ox+(s[1]*co-s[2]*si)*UM,Z=oz+(s[1]*si+s[2]*co)*UM;if(s[0])this._col.push([1,X,Z,s[3]*UM]);else this._col.push([0,X,Z,s[3]*UM,s[4]*UM,th+s[5]]);}}
  o.cols=null;o.ql=null;return _mb.call(this,dstB,dstO,o,ox,oy,oz,co,si);};}
{const _b=Tn.build;Tn.build=function(c,civ){this._col=[];this._decks=[];this._moor=[];let e;try{e=_b.call(this,c,civ);}finally{e&&(e.col=this._col,e.decks=this._decks,e.moor=this._moor);this._col=this._decks=this._moor=null;}
  let R=0;for(const s of e.col)R=Math.max(R,Math.hypot(s[1]-c.x-0.5,s[2]-c.y-0.5));e.R=R+1.5;
  e.g.traverse(m=>{if(m.isMesh&&(m.material===this.B.soot||m.material===this.B.char&&false))m.castShadow=false;});return e;};}

// towns rebuild only on visible change; small growth waits until the player is out of town (or two minutes pass)
Tn.refresh=function(){const w=W,px=FP.px,pz=FP.pz,RC=Math.min(520,170*TV.lodR()),now=performance.now();const keep=new Set();this.buildings=[];const todo=[];
 for(const c of w.cities){if(Math.abs(c.x-px)>RC||Math.abs(c.y-pz)>RC)continue;keep.add(c);const civ=w.civById(c.civ);const era=civ?civ.era:0,ruins=c.state!=='alive';const N=this.count(c,era,ruins,(c.robotic||0)>0.1||(c.machine||0)>0.1);
  const e=this.cities.get(c),dist=Math.hypot(c.x-px,c.y-pz);
  // distant towns are built with a capped number of houses and filled in as the player approaches
  const lod=dist>70||(e&&e.lod&&dist>55)?1:0;c._lod=lod;const [major,minor0]=this.keys(c,civ,era,N),minor=minor0+'|'+lod;
  const stale=!e||e.major!==major||(e.minor!==minor&&(dist>(e.R||8)+4||now-e.t>120000));
  if(stale)todo.push([dist,c,civ,major,minor,e]);else this.buildings.push(...e.bl);}
 // nearest first; towns close by are built at once, distant ones one per refresh so they stream in without a hitch
 todo.sort((a,b)=>a[0]-b[0]);const t0=performance.now();let built=false;
 for(const [dist,c,civ,major,minor,old] of todo){if(built&&(dist>25||performance.now()-t0>20)){if(old)this.buildings.push(...old.bl);continue;}
  if(old){this.group.remove(old.g);old.g.traverse(o=>{if(o.geometry)o.geometry.dispose();});}const e=this.build(c,civ);
  // building a town fills in its trade buildings, so take the key again afterwards or it would rebuild straight away
  const era=civ?civ.era:0,k2=this.keys(c,civ,era,this.count(c,era,c.state!=='alive',(c.robotic||0)>0.1||(c.machine||0)>0.1));e.major=k2[0];e.minor=k2[1]+'|'+(c._lod||0);e.lod=c._lod||0;e.t=now;this.cities.set(c,e);this.group.add(e.g);this.buildings.push(...e.bl);built=true;}
 for(const [c,e] of this.cities)if(!keep.has(c)){this.group.remove(e.g);e.g.traverse(o=>{if(o.geometry)o.geometry.dispose();});this.cities.delete(c);}
 this.occupied=new Set();this.fields=new Set();this.cellMap=new Map();const cm=new Map(),n=w.n;this.moored=[];this.cdecks=[];
 for(const [,e] of this.cities){for(const i of e.occ)this.occupied.add(i);for(const i of e.fld)this.fields.add(i);for(const [i,a] of e.cc){const b=this.cellMap.get(i);this.cellMap.set(i,b?b.concat(a):a);}
  if(e.moor)this.moored.push(...e.moor);if(e.decks)this.cdecks.push(...e.decks);
  if(e.col)for(const s of e.col){if(!s[0]&&s.length<8){s[6]=Math.cos(s[5]);s[7]=Math.sin(s[5]);}const r=s[0]?s[3]:Math.hypot(s[3],s[4]);const X0=Math.max(0,Math.floor(s[1]-r-0.1)),X1=Math.min(n-1,Math.floor(s[1]+r+0.1)),Z0=Math.max(0,Math.floor(s[2]-r-0.1)),Z1=Math.min(n-1,Math.floor(s[2]+r+0.1));
   for(let z=Z0;z<=Z1;z++)for(let x=X0;x<=X1;x++){const k=z*n+x;const a=cm.get(k);if(a)a.push(s);else cm.set(k,[s]);}}}
 this.colMap=cm;
 if(built){this.lastRoad=null;if(this.tv.Veg){this.tv.Veg.last=null;this.tv.Veg.lastG=null;}}
 if(!this.lastRoad||Math.hypot(px-this.lastRoad[0],pz-this.lastRoad[1])>12*TV.lodR()||performance.now()-this.lastRoad[2]>30000)this.buildRoads();};
{const _cnt=Tn.count;Tn.count=function(c,era,ruins,robotic){const N=_cnt.call(this,c,era,ruins,robotic);return this._building&&c._lod?Math.min(N,36):N;};}
{const _bd=Tn.build;Tn.build=function(c,civ){this._building=true;try{return _bd.call(this,c,civ);}finally{this._building=false;}};}
Tn.keys=function(c,civ,era,N){return [`${c.state}|${era}|${c.damage>0.06?Math.round(c.damage*6):0}|${c.walls?1:0}|${c.port?1:0}|${c.robotic>0.1?1:0}|${c.machine>0.1?1:0}|${c.life?c.life.generation:0}|${civ?civ.color:''}`,
 `${c.level}|${Math.round(Math.log(Math.max(1,N))/0.26)}|${c.rubble?Object.keys(c.rubble).length:0}|${c.buildings?c.buildings.length:0}`];};
{const _r=Tn.reset;Tn.reset=function(){_r.call(this);this.colMap=null;this.moored=[];this.cdecks=[];this.rdecks=[];this.roadPaths=[];this.rseg=null;};}
// how far a circle of radius pr at (x,z) sinks into a building
Tn.pen=function(x,z,pr){const m=this.colMap;if(!m)return 0;const n=W.n,xi=x|0,zi=z|0;if(xi<0||zi<0||xi>=n||zi>=n)return 0;const a=m.get(zi*n+xi);if(!a)return 0;let best=0;
 for(let k=0;k<a.length;k++){const s=a[k],dx=x-s[1],dz=z-s[2];let p;if(s[0])p=s[3]+pr-Math.sqrt(dx*dx+dz*dz);else{const lx=dx*s[6]+dz*s[7],lz=-dx*s[7]+dz*s[6];const ox=s[3]+pr-Math.abs(lx),oz=s[4]+pr-Math.abs(lz);p=ox>0&&oz>0?Math.min(ox,oz):0;}if(p>best)best=p;}return best;};
// push a point out of any building it is inside (townsfolk, the camera)
Tn.resolve=function(x,z,pr){const m=this.colMap;if(!m)return null;const n=W.n;let moved=false;
 for(let it=0;it<3;it++){const xi=x|0,zi=z|0;if(xi<0||zi<0||xi>=n||zi>=n)break;const a=m.get(zi*n+xi);if(!a)break;let hit=false;
  for(const s of a){const dx=x-s[1],dz=z-s[2];if(s[0]){const d=Math.sqrt(dx*dx+dz*dz),R=s[3]+pr;if(d<R){if(d>1e-6){x=s[1]+dx/d*R;z=s[2]+dz/d*R;}else x=s[1]+R;hit=true;}}
   else{let lx=dx*s[6]+dz*s[7],lz=-dx*s[7]+dz*s[6];const ox=s[3]+pr-Math.abs(lx),oz=s[4]+pr-Math.abs(lz);if(ox>0&&oz>0){if(ox<oz)lx=(lx<0?-1:1)*(s[3]+pr);else lz=(lz<0?-1:1)*(s[4]+pr);x=s[1]+lx*s[6]-lz*s[7];z=s[2]+lx*s[7]+lz*s[6];hit=true;}}}
  if(!hit)break;moved=true;}return moved?[x,z]:null;};
// walkable decks: bridges and piers
Tn.deckAt=function(x,z){let best=null;for(const A of [this.rdecks,this.cdecks]){if(!A)continue;for(const d of A){if(x<d.x0||x>d.x1||z<d.z0||z>d.z1)continue;const ux=d.bx-d.ax,uz=d.bz-d.az,L2=ux*ux+uz*uz||1;const t=((x-d.ax)*ux+(z-d.az)*uz)/L2;if(t<-0.02||t>1.02)continue;const cx=d.ax+ux*t-x,cz=d.az+uz*t-z;if(cx*cx+cz*cz>d.hw*d.hw)continue;const tt=clamp(t,0,1);const y=d.hA+(d.hB-d.hA)*tt+d.bump*Math.sin(Math.PI*tt);if(best===null||y>best)best=y;}}return best;};
Tn.addDeck=function(list,ax,az,bx,bz,hw,hA,hB,bump){list.push({ax,az,bx,bz,hw,hA,hB,bump:bump||0,x0:Math.min(ax,bx)-hw,x1:Math.max(ax,bx)+hw,z0:Math.min(az,bz)-hw,z1:Math.max(az,bz)+hw});};

// the possessed creature: solid buildings, bridges and piers
FP.colR=function(){if(this.isHuman)return 0.042;const s=this.sp;return clamp(TV.Life.sizeOf(s)*((this.ent&&this.ent.big)||1)*0.4,0.02,0.2);};
{const _hb=FP.hitBuilding;FP.hitBuilding=function(x,z){if(!(this.three&&Tn.colMap&&TV.active))return _hb.call(this,x,z);const pr=this.colR();const p1=Tn.pen(x,z,pr);if(p1<=0)return false;return !(p1<Tn.pen(this.px,this.pz,pr)-1e-5);};}
// a creature possessed (or a town rebuilt) while standing inside a building is moved out to the nearest wall face
{const _up=FP.update;FP.update=function(dt,now){if(this.three&&TV.active&&Tn.colMap&&!this.interior&&this.ent&&!this.ent.dead){const h=this.hab();if(h!=='a'&&h!=='w'){const r=Tn.resolve(this.px,this.pz,this.colR());if(r){this.px=r[0];this.pz=r[1];}}}return _up.call(this,dt,now);};}
{const _gy=FP.groundY,_ce=FP.canEnter;
 FP.groundY=function(x,z){const g=_gy.call(this,x,z);if(this.three&&TV.active&&this.hab()!=='w'){const d=Tn.deckAt(x,z);if(d!==null&&d>g)return d;}return g;};
 FP.canEnter=function(x,z){if(this.three&&TV.active&&this.hab()==='l'&&Tn.deckAt(x,z)!==null)return true;return _ce.call(this,x,z);};}
// townsfolk walk around buildings instead of through them, and over bridges instead of along river beds
{const _sm=Lf.smooth;Lf.smooth=function(e,dt){_sm.call(this,e,dt);if(!Tn.colMap||e===FP.ent)return;const s=e.prof!==undefined?null:SPECIES[e.sp];if(s&&(s.hab==='a'||s.hab==='w'||s.shape==='boat'))return;const r=Tn.resolve(e._rx,e._rz,0.03);if(r){e._rx=r[0];e._rz=r[1];}};
 const _g=Lf.groundOf;Lf.groundOf=function(o){const g=_g.call(this,o);const d=Tn.deckAt(o._rx,o._rz);return d!==null&&d>g?d:g;};}

// ============================================================
//  HARBOURS: piers on piles, bollards and cargo, moored boats, cranes, a lighthouse
// ============================================================
Tn.harbour=function(c,g,era,bl){const w=W,n=w.n;let best=null;
 for(let d=1;d<=7&&!best;d++)for(let k=0;k<24;k++){const a=k/24*6.283,x=Math.round(c.x+Math.cos(a)*d),y=Math.round(c.y+Math.sin(a)*d);if(w.inB(x,y)&&w.elev[y*n+x]<0){best=a;break;}}
 if(best===null)return;const dx=Math.cos(best),dz=Math.sin(best),tx=-dz,tz=dx;const R=tvRnd(c.id*53+7);
 let sx=null,sz=null;for(let s=0;s<14;s+=0.08){const x=c.x+0.5+dx*s,z=c.y+0.5+dz*s;if(x<1||z<1||x>n-1||z>n-1)break;if(TV.terrH(x,z)<0.015){sx=x-dx*0.12;sz=z-dz*0.12;break;}}
 if(sx===null)return;
 const np=era>=7?3:era>=4?2:1,Lp=era>=7?2.4:era>=4?1.7:1.1,wd=era>=7?0.3:0.2,deckK=era>=7?'concrete':'plank',pileK=era>=7?'concrete':'wood',dy=0.075;
 const offs=np===1?[0]:np===2?[-0.7,0.7]:[-1.3,0,1.3];this._moor=this._moor||[];
 offs.forEach((off,pi)=>{const px=sx+tx*off,pz=sz+tz*off;if(TV.terrH(px+dx*0.8,pz+dz*0.8)>-0.01)return;
  const cx=px+dx*(Lp-0.3)/2,cz=pz+dz*(Lp-0.3)/2;this.box(g(deckK),cx,dy,cz,Lp+0.3,wd,0.035,best,0.5);
  // a short ramp from the quay down onto the deck
  const hq=Math.max(dy+0.035,TV.terrH(px-dx*0.35,pz-dz*0.35)+0.01);this.box(g(deckK),px-dx*0.3,Math.min(dy,hq-0.03),pz-dz*0.3,0.5,wd,Math.abs(hq-dy)+0.035,best,0.5);
  for(let s=-0.1;s<Lp;s+=0.32)for(const sd of [-1,1]){const x=px+dx*s+tx*sd*wd*0.42,z=pz+dz*s+tz*sd*wd*0.42;const gb=TV.terrH(x,z);if(gb>dy-0.02)continue;this.cyl(g(pileK),x,gb-0.05,z,era>=7?0.03:0.022,dy-gb+0.08,6,1);}
  for(let s=0.3;s<Lp;s+=0.55){for(const sd of [-1,1])this.cyl(g('metal'),px+dx*s+tx*sd*wd*0.4,dy+0.035,pz+dz*s+tz*sd*wd*0.4,0.012,0.035,6,1);}
  for(let k=0;k<3;k++){const s=0.2+R()*(Lp-0.4),sd=(R()-0.5)*wd*0.5;this.box(g(R()<0.5?'wood':'plank'),px+dx*s+tx*sd,dy+0.035,pz+dz*s+tz*sd,0.07,0.06,0.05+R()*0.04,best+R(),1);}
  if(era>=6)for(let s=0.4;s<Lp;s+=0.9){const x=px+dx*s+tx*wd*0.45,z=pz+dz*s+tz*wd*0.45;this.cyl(g('metal'),x,dy+0.035,z,0.008,0.38,6,1);this.box(g('lit'),x,dy+0.41,z,0.04,0.04,0.03,0,1);}
  Tn.addDeck(this._decks,px-dx*0.55,pz-dz*0.55,px+dx*(Lp-0.15),pz+dz*(Lp-0.15),wd/2,dy+0.035,dy+0.035,0);
  // moored boats alongside
  const ty=era<=1?'canoe':era<=4?(R()<0.5?'cog':'sailboat'):era<=6?(R()<0.4?'galleon':'cog'):era===7?(R()<0.5?'steamer':'trawler'):(R()<0.35?'cargo':'trawler');
  // moor alongside only where the whole hull floats: try the era's ship, then smaller ones
  const moor=(types,side,id)=>{for(const t3 of types){const S=TV.Ships.def[t3];if(!S)continue;const off=wd/2+S.B/2+0.05;for(const along of [Math.max(0.2+S.L/2,Lp*0.5),Lp-0.1,Lp+S.L*0.3]){const mx=px+dx*along+tx*side*off,mz=pz+dz*along+tz*side*off;let ok=true;
     for(const u of [-0.5,-0.25,0,0.25,0.5])for(const v of [-0.5,0.5]){if(TV.terrH(mx+dx*S.L*u+tx*S.B*v,mz+dz*S.L*u+tz*S.B*v)>-S.D*0.5){ok=false;break;}}
     if(ok){this._moor.push({x:mx,z:mz,yaw:best+(R()<0.5?0:Math.PI),type:t3,civ:c.civ,id});return;}}}};
  const smalls=era<=1?['canoe']:era>=7?['trawler','sailboat']:['sailboat','canoe'];
  moor([ty].concat(smalls),pi%2?1:-1,c.id*7+pi);if(R()<0.6&&era>=2)moor(smalls,pi%2?-1:1,c.id*7+pi+3);
  // dockside cranes in the industrial eras
  if(era>=7&&pi!==1){const x=px+dx*0.25-tx*wd*0.2,z=pz+dz*0.25-tz*wd*0.2,y=dy+0.035;for(const [ox,oz] of [[-0.05,-0.05],[0.05,-0.05],[-0.05,0.05],[0.05,0.05]])this.box(g('metal'),x+ox,y,z+oz,0.018,0.018,1.1,0,1);
   this.box(g('metal'),x,y+1.1,z,0.16,0.16,0.08,best,1);this.box(g('metal'),x+dx*0.45,y+1.18,z+dz*0.45,1.2,0.05,0.05,best,1);this.box(g('dark'),x-dx*0.2,y+1.1,z-dz*0.2,0.18,0.12,0.1,best,1);this.cyl(g('metal'),x+dx*0.95,y+0.55,z+dz*0.95,0.004,0.63,4,1);
   if(this._col)this._col.push([1,x,z,0.09]);}});
 // lighthouse at the harbour mouth
 if(era>=3&&c.level>=2){const lx=sx+tx*(offs[0]-0.9)+dx*0.15,lz=sz+tz*(offs[0]-0.9)+dz*0.15,ly=Math.max(0.02,TV.terrH(lx,lz))-0.02;
  this.cyl(g('stone'),lx,ly-0.2,lz,0.17,0.32,12,1);this.cyl(g('white'),lx,ly+0.1,lz,0.12,1.0,12,1);for(const h of [0.3,0.62])this.cyl(g('brick'),lx,ly+0.1+h,lz,0.122,0.12,12,1);
  this.cyl(g('lit'),lx,ly+1.1,lz,0.085,0.12,8,1);this.cone(g('metal'),lx,ly+1.22,lz,0.11,0.1,8,1);this.cyl(g('metal'),lx,ly+1.1,lz,0.13,0.012,12,1);if(this._col)this._col.push([1,lx,lz,0.15]);}};

// ============================================================
//  RIVERS AND LAKES: one continuous surface on the terrain's own vertex grid. Levels are smoothed along
//  the water so there are no steps, the surface runs on into the banks so the shoreline is where water
//  meets ground, and every vertex carries depth, flow and rapids for the shader.
// ============================================================
// a river that steps diagonally only touches at cell corners; the lower of the two side cells becomes part of the channel
const isRiv=(w,i)=>w.elev[i]>=0&&w.water[i]>0&&w.river[i]!==2;
TV.riverLinks=function(x0,z0,x1,z1,cb){const w=W,n=w.n,H=this.H;for(let z=Math.max(1,z0);z<=Math.min(n-2,z1);z++)for(let x=Math.max(1,x0);x<=Math.min(n-2,x1);x++){const i=z*n+x;if(!isRiv(w,i))continue;
  for(const dz of [1,-1]){const j=(z+dz)*n+x+1;if(!isRiv(w,j))continue;const a=z*n+x+1,b=(z+dz)*n+x;if(w.isWater(a)||w.isWater(b)||w.elev[a]<0||w.elev[b]<0)continue;cb(H[a]<=H[b]?a:b,i,j);}}};
{const _sm=TV.smooth;TV.smooth=function(x0,z0,x1,z1){_sm.call(this,x0,z0,x1,z1);const H=this.H;if(!H)return;this.riverLinks(x0-1,z0-1,x1+1,z1+1,(c,i,j)=>{H[c]=Math.max(0.012,Math.min(H[c],(H[i]+H[j])/2));});};}
TV.makeRiverMat=function(){const T=this.T,U=this.U;
 const vs=`#include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  attribute float aDepth;attribute vec2 aFlow;attribute float aFoam;uniform float uTime;
  varying vec3 vWp;varying float vDepth;varying vec2 vFlow;varying float vFoam;
  void main(){vec3 p=(modelMatrix*vec4(position,1.)).xyz;float s=length(aFlow);
   p.y+=(sin(p.x*7.1+uTime*1.7)*sin(p.z*6.3-uTime*1.3))*0.0022*(0.3+s)*smoothstep(0.,0.6,aDepth);
   vWp=p;vDepth=aDepth;vFlow=aFlow;vFoam=aFoam;vec4 mvPosition=viewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mvPosition;
   #include <logdepthbuf_vertex>
   #include <fog_vertex>
  }`;
 const fs=`#include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  uniform float uTime,uIce;uniform sampler2D tWN;uniform vec3 uSunCol,uAmb,uWind;
  varying vec3 vWp;varying float vDepth;varying vec2 vFlow;varying float vFoam;
  ${this.skyGLSL}
  vec3 nrm(vec2 uv){return texture2D(tWN,uv).xyz*2.-1.;}
  void main(){
   #include <logdepthbuf_fragment>
   vec2 uv=vWp.xz;float sp=length(vFlow);
   // two-phase flow mapping: ripples travel downstream without smearing
   float ph0=fract(uTime*0.22),ph1=fract(uTime*0.22+0.5),bw=abs(ph0*2.-1.);vec2 fl=vFlow*1.5;
   vec3 nA=nrm(uv*0.42-fl*ph0)+nrm(uv*1.35-fl*ph0*2.+0.31)*0.6,nB=nrm(uv*0.42-fl*ph1+0.5)+nrm(uv*1.35-fl*ph1*2.+0.77)*0.6;
   vec3 n3=mix(nA,nB,bw)+nrm(uv*0.11+uWind.xz*uTime*0.012)*0.7;float bump=0.07+sp*0.12;
   vec3 N=normalize(vec3(n3.x*bump,1.,n3.y*bump));vec3 V=normalize(cameraPosition-vWp);float dist=length(cameraPosition-vWp);
   float F=0.02+0.98*pow(1.-max(dot(N,V),0.),5.);vec3 R=reflect(-V,N);R.y=abs(R.y);vec3 refl=skyCol(R);
   float lit=max(uSun.y,0.)*0.8+0.2;vec3 Lc=uAmb*0.9+uSunCol*0.32*lit;float dep=max(vDepth,0.);
   vec3 shallow=mix(vec3(0.07,0.19,0.16),vec3(0.17,0.15,0.09),clamp(sp*0.7,0.,0.55));vec3 deep=vec3(0.012,0.055,0.08);
   vec3 body=mix(shallow,deep,1.-exp(-dep*0.32))*Lc;vec3 col=mix(body,refl,F);
   col+=uSunCol*pow(max(dot(R,uSun),0.),300.)*4.*step(0.,uSun.y)+uSunCol*pow(max(dot(R,uSun),0.),24.)*0.06;
   float nz=texture2D(tWN,uv*0.9-vFlow*uTime*0.35).a,nz2=texture2D(tWN,uv*2.3-vFlow*uTime*0.8+0.4).a;
   float shore=(1.-smoothstep(0.05,0.55,dep))*smoothstep(0.45,0.75,nz*0.7+nz2*0.5);
   float rap=clamp(vFoam,0.,1.)*smoothstep(0.3,0.7,nz2*0.8+nz*0.4);float stream=smoothstep(0.6,1.4,sp)*smoothstep(0.55,0.8,nz2)*0.6;
   float foam=clamp(shore*0.7+rap+stream,0.,1.)*(1.-uIce);col=mix(col,(uAmb+uSunCol*0.55*lit)*0.92,foam*0.85);
   float icen=texture2D(tWN,uv*0.9).a;vec3 iceC=vec3(0.72,0.8,0.88)*(uAmb*1.2+uSunCol*0.5*lit)+uSunCol*pow(max(dot(reflect(-V,N),uSun),0.),60.)*0.4;
   col=mix(col,iceC*(0.85+icen*0.3),uIce*0.9);
   float a=clamp(smoothstep(0.,0.9,dep)*0.86+F*0.5+foam*0.6,0.,1.);a=mix(a,1.,uIce*0.9);a=mix(a,1.,smoothstep(120.,220.,dist)*step(0.3,dep));
   gl_FragColor=vec4(col,a);
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
   #include <fog_fragment>
  }`;
 const m=new T.ShaderMaterial({uniforms:T.UniformsUtils.merge([T.UniformsLib.fog,{}]),vertexShader:vs,fragmentShader:fs,fog:true,transparent:true,depthWrite:true});
 Object.assign(m.uniforms,U,{tWN:{value:this.tex.wn},uSunColS:this.oceanMat.uniforms.uSunColS,uIce:this.lakeMat.uniforms.uIce});
 m.uniforms.fogColor=this.oceanMat.uniforms.fogColor;m.uniforms.fogDensity=this.oceanMat.uniforms.fogDensity;return m;};
TV.buildLakes=function(){const T=this.T,w=W,n=w.n,R0=Math.min(280,110*TV.lodR())|0,cx=FP.px|0,cz=FP.pz|0,now=performance.now();
 const L=this._wl;if(L&&Math.abs(L.cx-cx)<8&&Math.abs(L.cz-cz)<8&&now-L.t<2500)return;
 if(!this.riverMat)this.riverMat=this.makeRiverMat();
 const x0=Math.max(0,cx-R0),x1=Math.min(n-1,cx+R0),z0=Math.max(0,cz-R0),z1=Math.min(n-1,cz+R0),NX=x1-x0+1,NZ=z1-z0+1,N=NX*NZ,H=this.H;
 const top=new Float32Array(N),wet=new Uint8Array(N),dep=new Float32Array(N),lake=new Uint8Array(N);let any=false;
 for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){const i=z*n+x;if(!w.isWater(i)||w.elev[i]<0)continue;const k=(z-z0)*NX+(x-x0);
  top[k]=FP.waterTop(i)+(w.flood[i]>0.4&&w.water[i]<=0?Math.min(0.5,w.flood[i]*0.04):0);wet[k]=1;lake[k]=w.river[i]===2?1:0;dep[k]=Math.min(30,0.9+w.depthM(i)*(lake[k]?0.5:0.6));any=true;}
 this.riverLinks(x0,z0,x1,z1,(c,i,j)=>{const cx2=c%n-x0,cz2=(c/n|0)-z0;if(cx2<0||cz2<0||cx2>=NX||cz2>=NZ)return;const k=cz2*NX+cx2,ki=((i/n|0)-z0)*NX+(i%n-x0),kj=((j/n|0)-z0)*NX+(j%n-x0);
  const ti=ki>=0&&ki<N&&wet[ki]?top[ki]:FP.waterTop(i),tj=kj>=0&&kj<N&&wet[kj]?top[kj]:FP.waterTop(j);top[k]=Math.max(H[c]+0.02,(ti+tj)/2);wet[k]=1;dep[k]=1.4;any=true;});
 if(this.lakes){this.groups.water.remove(this.lakes);this.lakes.geometry.dispose();this.lakes=null;}
 this._wl={cx,cz,t:now,x0,z0,NX,NZ,hv:null,def:null};if(!any)return;
 // smooth the level along the water (two passes), never below the bed
 let a=top,b=new Float32Array(N);for(let pass=0;pass<2;pass++){for(let gz=0;gz<NZ;gz++)for(let gx=0;gx<NX;gx++){const k=gz*NX+gx;if(!wet[k])continue;let s=a[k]*2,ws=2;
   for(let dz=-1;dz<=1;dz++){const zz=gz+dz;if(zz<0||zz>=NZ)continue;for(let dx=-1;dx<=1;dx++){if(!dx&&!dz)continue;const xx=gx+dx;if(xx<0||xx>=NX)continue;const q=zz*NX+xx;if(wet[q]){s+=a[q];ws++;}}}
   b[k]=Math.max(s/ws,H[(gz+z0)*n+gx+x0]+0.012);}const t=a;a=b;b=t===top?new Float32Array(N):t;}
 const lv=a;
 // never above the lowest dry bank (rivers only; lakes keep their level)
 for(let gz=0;gz<NZ;gz++)for(let gx=0;gx<NX;gx++){const k=gz*NX+gx;if(!wet[k]||lake[k])continue;const X=gx+x0,Z=gz+z0;let m=1e9;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){const xx=X+dx,zz=Z+dz;if(xx<0||zz<0||xx>=n||zz>=n)continue;const j=zz*n+xx;if(w.isWater(j)||w.elev[j]<0)continue;const kk=(zz-z0)*NX+(xx-x0);if(xx>=x0&&xx<=x1&&zz>=z0&&zz<=z1&&wet[kk])continue;if(H[j]<m)m=H[j];}
  if(m<1e9)lv[k]=Math.max(H[Z*n+X]+0.006,Math.min(lv[k],m-0.01));}
 // vertex heights: the water level, carried on into the banks (just under the ground where the bank is lower)
 const hv=new Float32Array(N),def=new Uint8Array(N),fx=new Float32Array(N),fz=new Float32Array(N),fo=new Float32Array(N),dv=new Float32Array(N);
 for(let gz=0;gz<NZ;gz++)for(let gx=0;gx<NX;gx++){const k=gz*NX+gx,Hk=H[(gz+z0)*n+gx+x0];if(wet[k]){hv[k]=lv[k];def[k]=1;dv[k]=dep[k];continue;}
  let s=0,c=0;for(let dz=-1;dz<=1;dz++){const zz=gz+dz;if(zz<0||zz>=NZ)continue;for(let dx=-1;dx<=1;dx++){const xx=gx+dx;if(xx<0||xx>=NX)continue;const q=zz*NX+xx;if(wet[q]){s+=lv[q];c++;}}}
  if(c){hv[k]=Math.min(s/c,Hk-0.012);def[k]=1;}}
 // flow runs downhill along the water surface; steep drops become rapids
 for(let gz=0;gz<NZ;gz++)for(let gx=0;gx<NX;gx++){const k=gz*NX+gx;if(!wet[k])continue;const h=(q,f)=>q>=0&&q<N&&wet[q]?lv[q]:f;
  const hl=gx>0?h(k-1,lv[k]):lv[k],hr=gx<NX-1?h(k+1,lv[k]):lv[k],hu=gz>0?h(k-NX,lv[k]):lv[k],hd=gz<NZ-1?h(k+NX,lv[k]):lv[k];
  let ux=-(hr-hl)/2,uz=-(hd-hu)/2;const s=Math.hypot(ux,uz);const sp=lake[k]?Math.min(0.12,s*20):clamp(s*55,0.12,1.6);
  if(s>1e-6){ux/=s;uz/=s;}else{ux=0;uz=0;}fx[k]=ux*sp;fz[k]=uz*sp;fo[k]=lake[k]?0:clamp((s-0.01)*45,0,1);}
 // dry rim vertices take the average flow of their wet neighbours so the current reaches the bank
 for(let gz=0;gz<NZ;gz++)for(let gx=0;gx<NX;gx++){const k=gz*NX+gx;if(wet[k]||!def[k])continue;let sx=0,sz=0,c=0;for(const q of [k-1,k+1,k-NX,k+NX])if(q>=0&&q<N&&wet[q]){sx+=fx[q];sz+=fz[q];c++;}if(c){fx[k]=sx/c*0.6;fz[k]=sz/c*0.6;}}
 const vi=new Int32Array(N).fill(-1);let nv=0;for(let k=0;k<N;k++)if(def[k])vi[k]=nv++;
 const pos=new Float32Array(nv*3),dA=new Float32Array(nv),flA=new Float32Array(nv*2),foA=new Float32Array(nv);
 for(let k=0;k<N;k++){const v=vi[k];if(v<0)continue;const gx=k%NX,gz=k/NX|0;pos[v*3]=gx+x0+0.5;pos[v*3+1]=hv[k];pos[v*3+2]=gz+z0+0.5;dA[v]=dv[k];flA[v*2]=fx[k];flA[v*2+1]=fz[k];foA[v]=fo[k];}
 const idx=[];for(let gz=0;gz<NZ-1;gz++)for(let gx=0;gx<NX-1;gx++){const A=gz*NX+gx,Bk=A+1,C=A+NX,D=C+1;if(!def[A]||!def[Bk]||!def[C]||!def[D])continue;if(!(wet[A]|wet[Bk]|wet[C]|wet[D]))continue;
  const a2=vi[A],b2=vi[Bk],c2=vi[C],d2=vi[D];if(((gx+x0)+(gz+z0))&1)idx.push(a2,c2,b2,b2,c2,d2);else idx.push(a2,c2,d2,a2,d2,b2);}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(pos,3));g.setAttribute('aDepth',new T.BufferAttribute(dA,1));g.setAttribute('aFlow',new T.BufferAttribute(flA,2));g.setAttribute('aFoam',new T.BufferAttribute(foA,1));
 g.setIndex(nv>65535?new T.BufferAttribute(new Uint32Array(idx),1):new T.BufferAttribute(new Uint16Array(idx),1));g.computeBoundingSphere();
 this.lakes=new T.Mesh(g,this.riverMat);this.lakes.renderOrder=2;this.lakes.frustumCulled=false;this.groups.water.add(this.lakes);
 this._wl.hv=hv;this._wl.def=def;};
// water surface height at a point (lily pads, river boats); null where there is no fresh water
TV.waterH=function(x,z){const L=this._wl;if(!L||!L.hv)return null;const gx=Math.round(x-0.5)-L.x0,gz=Math.round(z-0.5)-L.z0;if(gx<0||gz<0||gx>=L.NX||gz>=L.NZ)return null;const k=gz*L.NX+gx;return L.def[k]?L.hv[k]:null;};

// ============================================================
//  ROADS: the road cells become a graph, the graph becomes chains, and each chain becomes a smooth ribbon
//  (simplified, rounded, resampled) that hugs the terrain, with soft verges, lane markings on modern roads,
//  junction pads, and bridges wherever a road meets water.
// ============================================================
const rdp=(P,eps)=>{if(P.length<3)return P;let md=0,mi=0;const a=P[0],b=P[P.length-1],dx=b[0]-a[0],dz=b[1]-a[1],L=Math.hypot(dx,dz)||1;
 for(let i=1;i<P.length-1;i++){const d=Math.abs((P[i][0]-a[0])*dz-(P[i][1]-a[1])*dx)/L;if(d>md){md=d;mi=i;}}
 if(md<=eps)return [a,b];const l=rdp(P.slice(0,mi+1),eps),r=rdp(P.slice(mi),eps);return l.slice(0,-1).concat(r);};
const chaikin=(P,it)=>{for(let k=0;k<it;k++){if(P.length<3)return P;const o=[P[0]];for(let i=0;i<P.length-1;i++){const a=P[i],b=P[i+1];o.push([a[0]*0.75+b[0]*0.25,a[1]*0.75+b[1]*0.25],[a[0]*0.25+b[0]*0.75,a[1]*0.25+b[1]*0.75]);}o.push(P[P.length-1]);P=o;}return P;};
const resample=(P,step)=>{const o=[P[0]];let carry=0;for(let i=0;i<P.length-1;i++){const a=P[i],b=P[i+1],L=Math.hypot(b[0]-a[0],b[1]-a[1]);let s=step-carry;while(s<L){o.push([a[0]+(b[0]-a[0])*s/L,a[1]+(b[1]-a[1])*s/L]);s+=step;}carry=L-(s-step);}const e=P[P.length-1],l=o[o.length-1];if(Math.hypot(e[0]-l[0],e[1]-l[1])>step*0.3)o.push(e);else o[o.length-1]=e;return o;};
// a ribbon builder with explicit attributes (position, up normal, world uv, across-uv for the verge fade, colour)
class RB{constructor(){this.p=[];this.u=[];this.u1=[];this.c=[];this.i=[];this.v=0;}
 vert(x,y,z,u,v,u1,v1,c){this.p.push(x,y,z);this.u.push(u,v);this.u1.push(u1,v1);this.c.push(c[0],c[1],c[2]);return this.v++;}
 quad(a,b,c,d){const P=this.p;const cr=(P[b*3]-P[a*3])*(P[c*3+2]-P[a*3+2])-(P[b*3+2]-P[a*3+2])*(P[c*3]-P[a*3]);if(cr<0)this.i.push(a,b,c,a,c,d);else this.i.push(a,c,b,a,d,c);}
 geo(T){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(this.p,3));const nn=new Float32Array(this.v*3);for(let k=0;k<this.v;k++)nn[k*3+1]=1;g.setAttribute('normal',new T.BufferAttribute(nn,3));
  g.setAttribute('uv',new T.Float32BufferAttribute(this.u,2));g.setAttribute('uv1',new T.Float32BufferAttribute(this.u1,2));g.setAttribute('color',new T.Float32BufferAttribute(this.c,3));g.setIndex(this.i);g.computeBoundingSphere();return g;}}
// a little extra lift where the ground is uneven, so the ribbon never dips under a terrain edge
const roadY=(x,z,lift)=>{const h=TV.terrH(x,z),e=0.12;const s=Math.abs(TV.terrH(x+e,z)-h)+Math.abs(TV.terrH(x,z+e)-h);return h+lift+Math.min(0.05,s*0.22);};
Tn.onRoad=function(x,z,m){const R=this.rseg;if(!R)return false;const n=W.n,a=R.get((z|0)*n+(x|0));if(!a)return false;
 for(let k=0;k<a.length;k++){const s=a[k],ux=s[2]-s[0],uz=s[3]-s[1],L2=ux*ux+uz*uz;let t=L2>0?((x-s[0])*ux+(z-s[1])*uz)/L2:0;t=t<0?0:t>1?1:t;const dx=s[0]+ux*t-x,dz=s[1]+uz*t-z,r=s[4]+m;if(dx*dx+dz*dz<r*r)return true;}return false;};
Tn.buildRoads=function(){const T=this.tv.T,w=W,n=w.n,px=FP.px,pz=FP.pz,RR=Math.min(420,130*TV.lodR())|0;this.lastRoad=[px,pz,performance.now()];
 const x0=Math.max(0,(px|0)-RR),x1=Math.min(n-1,(px|0)+RR),z0=Math.max(0,(pz|0)-RR),z1=Math.min(n-1,(pz|0)+RR);
 const towns=[];for(const [c,e] of this.cities)if(c.state==='alive'||e.bl.length>3)towns.push([c.x+0.5,c.y+0.5,Math.max(2,(e.R||4)*0.8)]);
 const inTown=(x,z)=>{for(const t of towns){const dx=x+0.5-t[0],dz=z+0.5-t[1];if(dx*dx+dz*dz<t[2]*t[2])return true;}return false;};
 // the road raster is thinned to one-cell centrelines first, so double-width roads, interchange blocks and plazas
 // become single roads and clean junctions instead of ladders and waffles
 const GW=x1-x0+1,GH=z1-z0+1,RGd=new Uint8Array(GW*GH);for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){const i=z*n+x;if(w.road[i]&&(w.road[i]===2||!inTown(x,z)))RGd[(z-z0)*GW+(x-x0)]=1;}
 {const del=[];let changed=true,guard=0;while(changed&&guard++<40){changed=false;for(let pass=0;pass<2;pass++){del.length=0;for(let y=1;y<GH-1;y++)for(let x=1;x<GW-1;x++){const k=y*GW+x;if(!RGd[k])continue;
    const p2=RGd[k-GW],p3=RGd[k-GW+1],p4=RGd[k+1],p5=RGd[k+GW+1],p6=RGd[k+GW],p7=RGd[k+GW-1],p8=RGd[k-1],p9=RGd[k-GW-1];const Bn=p2+p3+p4+p5+p6+p7+p8+p9;if(Bn<2||Bn>6)continue;
    const A=(!p2&&p3)+(!p3&&p4)+(!p4&&p5)+(!p5&&p6)+(!p6&&p7)+(!p7&&p8)+(!p8&&p9)+(!p9&&p2);if(A!==1)continue;
    if(pass===0){if(p2&&p4&&p6)continue;if(p4&&p6&&p8)continue;}else{if(p2&&p4&&p8)continue;if(p2&&p6&&p8)continue;}del.push(k);}
   for(const k of del)RGd[k]=0;if(del.length)changed=true;}}}
 const nodes=[],id=new Map();for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){if(!RGd[(z-z0)*GW+(x-x0)])continue;const i=z*n+x;let ty=w.road[i];for(let dz=-1;dz<=1&&ty<2;dz++)for(let dx=-1;dx<=1;dx++){const j=i+dz*n+dx;if(j>=0&&j<w.count&&w.road[j]===2){ty=2;break;}}
  id.set(i,nodes.length);nodes.push({i,x,z,adj:[],type:ty,wet:w.isWater(i)||w.elev[i]<0});}
 const R=(x,z)=>{if(x<x0||x>x1||z<z0||z>z1)return null;const k=id.get(z*n+x);return k===undefined?null:nodes[k];};
 const link=(a,b,br)=>{if(a.adj.some(e=>e[0]===b))return;a.adj.push([b,br]);b.adj.push([a,br]);};
 const water=(x,z)=>w.inB(x,z)&&w.isWater(z*n+x);
 for(const a of nodes){for(const [dx,dz] of [[1,0],[0,1],[1,1],[1,-1]]){const b=R(a.x+dx,a.z+dz);if(!b)continue;if(dx&&dz&&(R(a.x+dx,a.z)||R(a.x,a.z+dz)))continue;link(a,b,a.wet||b.wet);}
  // gaps where the road stopped at a river or lake: bridge across up to six cells of water
  if(a.wet)continue;for(const [dx,dz] of [[1,0],[0,1],[1,1],[1,-1],[-1,0],[0,-1],[-1,-1],[-1,1]]){if(R(a.x+dx,a.z+dz)||!water(a.x+dx,a.z+dz))continue;
   for(let k=2;k<=6;k++){const x=a.x+dx*k,z=a.z+dz*k;const b=R(x,z);if(b){if(!b.wet)link(a,b,true);break;}if(!water(x,z))break;}}}
 const key=(a,b)=>a.i<b.i?a.i*1048576+b.i:b.i*1048576+a.i,used=new Set(),chains=[];
 const walk=(a,b,f)=>{const pts=[a],fl=[];let prev=a,cur=b,fb=f;used.add(key(a,b));for(let g=0;g<100000;g++){pts.push(cur);fl.push(fb);if(cur.adj.length!==2||cur===a)break;let nx=null;for(const [c,f2] of cur.adj){if(c===prev||used.has(key(cur,c)))continue;nx=c;fb=f2;break;}if(!nx)break;used.add(key(cur,nx));prev=cur;cur=nx;}chains.push({pts,fl});};
 for(const a of nodes)if(a.adj.length!==2)for(const [b,f] of a.adj)if(!used.has(key(a,b)))walk(a,b,f);
 for(const a of nodes)for(const [b,f] of a.adj)if(!used.has(key(a,b)))walk(a,b,f);
 const eraAt=(nd)=>{const o=w.owner[nd.i];const civ=o>=0?w.civById(o):null;return civ?civ.era:2;};
 const RBs={dirt:new RB(),cobble:new RB(),asphalt:new RB()},VB=new RB(),PB=new RB(),G={},g=(k)=>G[k]||(G[k]=new TVGB());
 const rseg=new Map(),paths=[],rdecks=[];const segIdx=(ax,az,bx,bz,hw)=>{const s=[ax,az,bx,bz,hw];const X0=Math.max(0,Math.floor(Math.min(ax,bx)-hw)),X1=Math.min(n-1,Math.floor(Math.max(ax,bx)+hw)),Z0=Math.max(0,Math.floor(Math.min(az,bz)-hw)),Z1=Math.min(n-1,Math.floor(Math.max(az,bz)+hw));for(let z=Z0;z<=Z1;z++)for(let x=X0;x<=X1;x++){const k=z*n+x,l=rseg.get(k);if(l)l.push(s);else rseg.set(k,[s]);}};
 const style=(era,hwy)=>{const mat=era>=7?'asphalt':era>=4?'cobble':'dirt';const hw=hwy?(era>=7?0.38:0.26):(mat==='asphalt'?0.25:mat==='cobble'?0.2:0.17);const lift=mat==='asphalt'?0.016:mat==='cobble'?0.014:0.011;
  const vc=mat==='asphalt'?[0.85,0.85,0.85]:mat==='cobble'?[0.95,0.92,0.88]:[1,0.95,0.88];return {mat,hw,lift,vw:mat==='asphalt'?0.12:0.16,vc,era,hwy};};
 const nodeStyle=new Map();
 const ribbon=(P,S)=>{const B=RBs[S.mat],N=P.length;if(N<2)return;let cum=0;const white=[0.92,0.92,0.88],yellow=[0.9,0.72,0.2];
  const L=[],C=[],Rr=[],VL=[],VR=[],PL=[],PR=[];
  for(let i=0;i<N;i++){const a=P[Math.max(0,i-1)],b=P[Math.min(N-1,i+1)];let tx=b[0]-a[0],tz=b[1]-a[1];const tl=Math.hypot(tx,tz)||1;tx/=tl;tz/=tl;const nx=-tz,nz=tx,x=P[i][0],z=P[i][1];if(i)cum+=Math.hypot(x-P[i-1][0],z-P[i-1][1]);
   const yL=roadY(x+nx*S.hw,z+nz*S.hw,S.lift),yC=roadY(x,z,S.lift),yR=roadY(x-nx*S.hw,z-nz*S.hw,S.lift);
   const us=S.mat==='cobble'?6:S.mat==='asphalt'?4:5;L.push(B.vert(x+nx*S.hw,yL,z+nz*S.hw,(x+nx*S.hw)*us,(z+nz*S.hw)*us,0,0,S.vc));C.push(B.vert(x,yC,z,x*us,z*us,0,0,S.vc));Rr.push(B.vert(x-nx*S.hw,yR,z-nz*S.hw,(x-nx*S.hw)*us,(z-nz*S.hw)*us,0,0,S.vc));
   const ow=S.hw+S.vw;VL.push([VB.vert(x+nx*S.hw,yL-0.003,z+nz*S.hw,(x+nx*S.hw)*2,(z+nz*S.hw)*2,cum,0,S.vc),VB.vert(x+nx*ow,roadY(x+nx*ow,z+nz*ow,0.004),z+nz*ow,(x+nx*ow)*2,(z+nz*ow)*2,cum,1,S.vc)]);
   VR.push([VB.vert(x-nx*S.hw,yR-0.003,z-nz*S.hw,(x-nx*S.hw)*2,(z-nz*S.hw)*2,cum,0,S.vc),VB.vert(x-nx*ow,roadY(x-nx*ow,z-nz*ow,0.004),z-nz*ow,(x-nx*ow)*2,(z-nz*ow)*2,cum,1,S.vc)]);
   if(S.mat==='asphalt'){const lw=0.012;const mk=(o)=>[PB.vert(x+nx*(o+lw),roadY(x+nx*(o+lw),z+nz*(o+lw),S.lift+0.003),z+nz*(o+lw),0,0,0,0,o===0&&S.hwy?yellow:white),PB.vert(x+nx*(o-lw),roadY(x+nx*(o-lw),z+nz*(o-lw),S.lift+0.003),z+nz*(o-lw),0,0,0,0,o===0&&S.hwy?yellow:white)];
    PL.push({c:mk(0),l:S.hwy?mk(S.hw-0.035):null,r:S.hwy?mk(-S.hw+0.035):null,dash:Math.floor(cum/0.4)%2===0});}
   if(i)segIdx(P[i-1][0],P[i-1][1],x,z,S.hw);}
  for(let i=0;i<N-1;i++){B.quad(L[i],C[i],C[i+1],L[i+1]);B.quad(C[i],Rr[i],Rr[i+1],C[i+1]);VB.quad(VL[i][0],VL[i][1],VL[i+1][1],VL[i+1][0]);VB.quad(VR[i][0],VR[i][1],VR[i+1][1],VR[i+1][0]);
   if(PL.length){const a=PL[i],b=PL[i+1];if(a.dash&&i>1&&i<N-3)PB.quad(a.c[0],a.c[1],b.c[1],b.c[0]);if(a.l){PB.quad(a.l[0],a.l[1],b.l[1],b.l[0]);PB.quad(a.r[0],a.r[1],b.r[1],b.r[0]);}}}};
 const pad=(x,z,S,r)=>{const B=RBs[S.mat],us=S.mat==='cobble'?6:S.mat==='asphalt'?4:5,c=B.vert(x,roadY(x,z,S.lift),z,x*us,z*us,0,0,S.vc),ring=[];for(let k=0;k<=12;k++){const a=k/12*6.2832,X=x+Math.cos(a)*r,Z=z+Math.sin(a)*r;ring.push(B.vert(X,roadY(X,Z,S.lift),Z,X*us,Z*us,0,0,S.vc));}for(let k=0;k<12;k++)B.quad(c,ring[k],ring[k+1],ring[k+1]);segIdx(x,z,x,z,r);};
 // bridge: a deck that arches clear of the water, with railings or parapets and piers down to the bed
 const bridge=(A,Bn,S)=>{const ax=A.x+0.5,az=A.z+0.5,bx=Bn.x+0.5,bz=Bn.z+0.5,L=Math.hypot(bx-ax,bz-az);if(L<0.3)return;const tx=(bx-ax)/L,tz=(bz-az)/L,nx=-tz,nz=tx,hw=S.hw+0.03;
  const hA=roadY(ax,az,S.lift),hB=roadY(bx,bz,S.lift);let wmax=-1;for(let s=0;s<=L;s+=0.25){const x=ax+tx*s,z=az+tz*s,i=(z|0)*n+(x|0);if(w.isWater(i))wmax=Math.max(wmax,w.elev[i]<0?0.05:FP.waterTop(i));}
  let bump=0;for(let t=0.2;t<=0.8;t+=0.1){const need=wmax+0.13-(hA+(hB-hA)*t);if(need>0)bump=Math.max(bump,need/Math.sin(Math.PI*t));}bump=Math.min(0.6,bump);
  const deckK=S.era>=7?'concrete':S.era>=4?'stone':'plank',railK=S.era>=7?'metal':S.era>=4?'stone':'wood',pierK=S.era>=7?'concrete':S.era>=4?'stone':'wood';
  const m=Math.max(4,Math.ceil(L/0.2)),Y=(t)=>hA+(hB-hA)*t+bump*Math.sin(Math.PI*t),th=S.era>=4?0.06:0.035;
  const dk=g(deckK);const fq=(gb,P,nrm)=>{const e1=[P[1][0]-P[0][0],P[1][1]-P[0][1],P[1][2]-P[0][2]],e2=[P[2][0]-P[0][0],P[2][1]-P[0][1],P[2][2]-P[0][2]];const c=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]];if(c[0]*nrm[0]+c[1]*nrm[1]+c[2]*nrm[2]<0)P=[P[1],P[0],P[3],P[2]];Tn.face(gb,P,nrm,0.5);};
  for(let k=0;k<m;k++){const t0=k/m,t1=(k+1)/m,X0=ax+tx*L*t0,Z0=az+tz*L*t0,X1=ax+tx*L*t1,Z1=az+tz*L*t1,y0=Y(t0),y1=Y(t1);
   fq(dk,[[X0+nx*hw,y0,Z0+nz*hw],[X1+nx*hw,y1,Z1+nz*hw],[X1-nx*hw,y1,Z1-nz*hw],[X0-nx*hw,y0,Z0-nz*hw]],[0,1,0]);
   fq(dk,[[X0+nx*hw,y0-th,Z0+nz*hw],[X1+nx*hw,y1-th,Z1+nz*hw],[X1-nx*hw,y1-th,Z1-nz*hw],[X0-nx*hw,y0-th,Z0-nz*hw]],[0,-1,0]);
   for(const sd of [1,-1]){fq(dk,[[X0+nx*hw*sd,y0-th,Z0+nz*hw*sd],[X1+nx*hw*sd,y1-th,Z1+nz*hw*sd],[X1+nx*hw*sd,y1,Z1+nz*hw*sd],[X0+nx*hw*sd,y0,Z0+nz*hw*sd]],[nx*sd,0,nz*sd]);
    const rx0=X0+nx*(hw-0.01)*sd,rz0=Z0+nz*(hw-0.01)*sd,rx1=X1+nx*(hw-0.01)*sd,rz1=Z1+nz*(hw-0.01)*sd;
    if(railK==='stone'){fq(g('stone'),[[rx0,y0,rz0],[rx1,y1,rz1],[rx1,y1+0.08,rz1],[rx0,y0+0.08,rz0]],[nx*sd,0,nz*sd]);fq(g('stone'),[[rx0,y0+0.08,rz0],[rx1,y1+0.08,rz1],[rx1-nx*sd*0.025,y1+0.08,rz1-nz*sd*0.025],[rx0-nx*sd*0.025,y0+0.08,rz0-nz*sd*0.025]],[0,1,0]);}
    else{const ry=railK==='metal'?0.09:0.08;fq(g(railK),[[rx0,y0+ry,rz0],[rx1,y1+ry,rz1],[rx1,y1+ry+0.012,rz1],[rx0,y0+ry+0.012,rz0]],[nx*sd,0,nz*sd]);if(k%2===0)Tn.cyl(g(railK),rx0,y0,rz0,0.007,ry+0.012,4,1);}}}
  let last=-9;for(let k=1;k<m;k++){const t=k/m,s=t*L;if(s-last<0.7||s<0.25||L-s<0.25)continue;const x=ax+tx*s,z=az+tz*s,gy=TV.terrH(x,z),y=Y(t)-th;if(y-gy<0.08)continue;last=s;
   if(pierK==='stone')Tn.box(g('stone'),x,gy-0.1,z,0.1,hw*2,y-gy+0.1,Math.atan2(tz,tx),0.6);else Tn.cyl(g(pierK),x,gy-0.1,z,pierK==='wood'?0.02:0.04,y-gy+0.1,8,1),Tn.cyl(g(pierK),x+nx*hw*0.7,gy-0.1,z+nz*hw*0.7,pierK==='wood'?0.018:0.035,y-gy+0.1,8,1),Tn.cyl(g(pierK),x-nx*hw*0.7,gy-0.1,z-nz*hw*0.7,pierK==='wood'?0.018:0.035,y-gy+0.1,8,1);}
  Tn.addDeck(rdecks,ax,az,bx,bz,hw,hA,hB,bump);segIdx(ax,az,bx,bz,hw);};
 for(const ch of chains){const N=ch.pts.length,mid=ch.pts[N>>1];const era=Math.max(eraAt(ch.pts[0]),eraAt(mid),eraAt(ch.pts[N-1]));const hwy=ch.pts.some(p=>p.type===2);const S=style(era,hwy);
  for(const p of [ch.pts[0],ch.pts[N-1]]){const o=nodeStyle.get(p);if(!o||o.hw<S.hw)nodeStyle.set(p,S);}
  // split the chain into dry runs and water crossings
  let run=[ch.pts[0]];const tp=[];const flush=()=>{if(run.length<2){run=[run[run.length-1]];return;}let P=run.map(p=>[p.x+0.5,p.z+0.5]);P=resample(chaikin(rdp(P,0.4),3),0.22);ribbon(P,S);tp.push(...P);run=[run[run.length-1]];};
  for(let k=1;k<N;k++){const a=ch.pts[k-1],b=ch.pts[k];if(ch.fl[k-1]){flush();
    // walk on over consecutive water links to the far bank
    let j=k;while(j<N&&(ch.fl[j-1])&&ch.pts[j].wet)j++;const far=ch.pts[Math.min(j,N-1)];bridge(a,far,S);tp.push([a.x+0.5,a.z+0.5],[far.x+0.5,far.z+0.5]);run=[far];k=Math.min(j,N-1);continue;}run.push(b);}
  flush();
  if(tp.length>1){const pts=[tp[0]];for(let k=1;k<tp.length;k++){const l=pts[pts.length-1];if(Math.hypot(tp[k][0]-l[0],tp[k][1]-l[1])>0.02)pts.push(tp[k]);}if(pts.length>1){const cum=[0];for(let k=1;k<pts.length;k++)cum.push(cum[k-1]+Math.hypot(pts[k][0]-pts[k-1][0],pts[k][1]-pts[k-1][1]));paths.push({pts,cum,len:cum[cum.length-1],hw:S.hw,era,hwy,mat:S.mat});}}}
 // junction pads and lone road cells (rest stops, crossroads)
 for(const a of nodes){if(a.wet||(a.adj.length===2))continue;const S=nodeStyle.get(a)||style(eraAt(a),a.type===2);pad(a.x+0.5,a.z+0.5,S,a.adj.length?S.hw*1.08:S.hw*1.6);}
 if(this.roads){this.group.remove(this.roads);this.roads.traverse(o=>{if(o.geometry)o.geometry.dispose();});}const grp=new T.Group();
 for(const k in RBs){if(!RBs[k].v)continue;const m=new T.Mesh(RBs[k].geo(T),this.rm[k]);m.receiveShadow=true;grp.add(m);}
 if(VB.v){const m=new T.Mesh(VB.geo(T),this.rm.verge);m.receiveShadow=true;m.renderOrder=1;grp.add(m);}
 if(PB.v){const m=new T.Mesh(PB.geo(T),this.rm.paint);m.receiveShadow=true;grp.add(m);}
 for(const k in G){if(!G[k].v)continue;const m=new T.Mesh(G[k].geo(),this.m[k]||this.m.stone);m.castShadow=true;m.receiveShadow=true;grp.add(m);}
 this.roads=grp;this.group.add(grp);this.rseg=rseg;this.rdecks=rdecks;this.roadPaths=paths;
 // index path ends so traffic can carry on from one road onto the next
 const ends=new Map();paths.forEach((p,pi)=>{for(const e of [0,1]){const q=e?p.pts[p.pts.length-1]:p.pts[0];const k=Math.round(q[0]*2)+','+Math.round(q[1]*2);const l=ends.get(k);if(l)l.push([pi,e]);else ends.set(k,[[pi,e]]);}});this.roadEnds=ends;
 if(this.tv.Veg)this.tv.Veg.lastG=null;};

// ============================================================
//  VEGETATION AND GROUND COVER
// ============================================================
// smooth value noise for meadow patches and clutter clusters
const vnoise=(x,z,s)=>{const X=Math.floor(x),Z=Math.floor(z),fx=x-X,fz=z-Z,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);const h=(i,j)=>hashI(i*73856093^j*19349663^s);
 const a=h(X,Z),b=h(X+1,Z),c=h(X,Z+1),d=h(X+1,Z+1);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;};
{const _init=V.init;V.init=function(tv){_init.call(this,tv);const T=tv.T,M=this.mats;
  const std=(o)=>new T.MeshStandardMaterial(Object.assign({roughness:0.92,metalness:0},o));
  const mk=(geo,mat,cap,shadow)=>{const m=new T.InstancedMesh(geo,mat,cap);m.count=0;m.frustumCulled=false;m.castShadow=!!shadow;m.receiveShadow=true;tv.groups.veg.add(m);return m;};
  // pebbles and stones
  {const g=new T.IcosahedronGeometry(1,0);const P=g.attributes.position;for(let k=0;k<P.count;k++){const x=P.getX(k),y=P.getY(k),z=P.getZ(k);const f=0.8+hashI(Math.round(x*91+y*37+z*53)+77)*0.35;P.setXYZ(k,x*f,y*f*0.55,z*f);}g.computeVertexNormals();
   this.pebbles=mk(g,std({map:tv.tex.rock,roughness:0.9}),9000,false);}
  // bushes reuse the shrub model
  {const pr=this.protos.shrub[0];this.bushL=pr.leaf?mk(pr.leaf,pr.lm,3200,true):null;this.bushT=pr.trunk?mk(pr.trunk,pr.tm,3200,false):null;}
  // ferns: a rosette of drooping fronds
  {const tex=tv.ctex('fern',128,256,(c,w,h)=>{c.clearRect(0,0,w,h);c.strokeStyle='#4c5a2a';c.lineWidth=3;c.beginPath();c.moveTo(64,250);c.quadraticCurveTo(60,120,64,6);c.stroke();
     for(let k=0;k<26;k++){const t=k/26,y=244-t*232,len=(1-Math.pow(t,1.2))*54*(0.55+Math.sin(t*3.14)*0.6)+6;const l=110+((k*37)%60);c.strokeStyle=`rgb(${l*0.55|0},${l|0},${l*0.4|0})`;c.lineWidth=5-t*2.5;for(const sd of [-1,1]){c.beginPath();c.moveTo(64,y);c.quadraticCurveTo(64+sd*len*0.6,y-6,64+sd*len,y-len*0.3);c.stroke();}}});
   const gb=new TVGB();for(let k=0;k<6;k++){const a=k/6*6.283+0.3,ca=Math.cos(a),sa=Math.sin(a),px=-sa*0.16,pz=ca*0.16;const segs=3,b=gb.v;
    for(let s=0;s<=segs;s++){const t=s/segs,d=t*0.95,y=Math.sin(t*1.9)*0.55-t*t*0.25,sh=0.55+0.45*t;gb.vert(ca*d-px,y,sa*d-pz,0,1,0,0,t,[sh,sh,sh]);gb.vert(ca*d+px,y,sa*d+pz,0,1,0,1,t,[sh,sh,sh]);}
    for(let s=0;s<segs;s++){const a2=b+s*2;gb.quad(a2,a2+1,a2+3,a2+2);}}
   const fm=std({map:tex,alphaTest:0.4,side:T.DoubleSide,vertexColors:true,roughness:0.8,alphaToCoverage:true});TV.windShader(fm,0.25,true);
   const ob=fm.onBeforeCompile;fm.onBeforeCompile=(sh)=>{ob(sh);sh.fragmentShader=sh.fragmentShader.replace('#include <normal_fragment_begin>','#include <normal_fragment_begin>\nnormal=normalize((viewMatrix*vec4(0.,1.,0.,0.)).xyz);');};fm.customProgramCacheKey=()=>'fern';
   this.ferns=mk(gb.geo(),fm,7000,false);}
  // fallen logs and stumps
  {const lg=new T.CylinderGeometry(1,1,1,8,1).rotateZ(Math.PI/2);this.logs=mk(lg,std({map:tv.tex.canvas.bark,vertexColors:false}),700,true);
   const sg=new T.CylinderGeometry(0.85,1.1,1,9,1).translate(0,0.5,0);this.stumps=mk(sg,std({map:tv.tex.canvas.bark}),1000,true);}
  // lily pads on still water
  {const g=new T.CircleGeometry(1,10,0.25,6.0).rotateX(-Math.PI/2);this.lilies=mk(g,std({color:0xffffff,roughness:0.55,side:T.DoubleSide}),1800,false);}
  // boulders: a little colour variation
  this.rocks.material.color.setRGB(1,1,1);};}
V.refresh=function(){const px=FP.px,pz=FP.pz;if(!this.last||Math.hypot(px-this.last[0],pz-this.last[1])>10*TV.lodR()||performance.now()-this.last[2]>30000)this.place();};
// trees: nearest cells first, so the tree budget always goes to what is closest (no lopsided forests)
V.place=function(){const T=this.tv.T,w=W,n=w.n,season=w.season();const px=FP.px,pz=FP.pz;this.last=[px,pz,performance.now()];const RN=42,RF=Math.min(320,Math.max(80,FP.settings.dist*1.7)*TV.lodR());
 const Tn2=this.tv.Town,built=Tn2.occupied||new Set();const cnt={near:{},far:{}};for(const L of ['near','far'])for(const k in this.protos)cnt[L][k]=0;
 const m=new T.Matrix4(),q=new T.Quaternion(),sc=new T.Vector3(),pos=new T.Vector3(),col=new T.Color(),Y=new T.Vector3(0,1,0);
 const x0=Math.max(0,px-RF|0),x1=Math.min(n-1,px+RF|0),z0=Math.max(0,pz-RF|0),z1=Math.min(n-1,pz+RF|0);const NB=Math.ceil(RF)+2,bk=Array.from({length:NB},()=>[]);
 for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){const i=z*n+x;const f=w.forest[i];if(f<0.12||w.isWater(i)||w.lava[i]>0||built.has(i))continue;const d=Math.hypot(x+0.5-px,z+0.5-pz);if(d>RF)continue;bk[d|0].push(i);}
 for(const list of bk)for(const i of list){const x=i%n,z=i/n|0,f=w.forest[i],d=Math.hypot(x+0.5-px,z+0.5-pz),L=d<RN?'near':'far';
  const vt=w.vegType[i];let k=w.burnt[i]>0.55?'dead':this.kind(vt);const c=L==='near'?(f>0.65?3:f>0.35?2:1):(f>0.5?2:1);
  const lc=PXT.leafCol(k==='oak'&&(VEGTYPES[vt]||{}).n==='Maple'?'maple':k==='birch'?'birch':k==='oak'?'oak':k,vt,season);const snowy=w.snow[i]>0.45;
  for(let j=0;j<c;j++){const set=this[L][k];const idx=cnt[L][k];if(!set.trunk&&!set.leaf||idx>=(L==='near'?2600:9000))continue;const H=this.H[k]*(0.7+hashI(i*5+j*7)*0.6)*(0.75+f*0.4);const X=x+0.15+hashI(i*7+j*13)*0.7,Z=z+0.15+hashI(i*11+j*17)*0.7;
   if(Tn2.onRoad(X,Z,0.1))continue;
   const hx1=FP.heightAt(X+0.6,Z),hx0=FP.heightAt(X-0.6,Z),hz1=FP.heightAt(X,Z+0.6),hz0=FP.heightAt(X,Z-0.6);const tsl=Math.abs(hx1-hx0)+Math.abs(hz1-hz0);if(tsl>1.0)continue;cnt[L][k]++;
   pos.set(X,Math.min(FP.heightAt(X,Z),(hx1+hx0+hz1+hz0)*0.25)-0.03-Math.min(0.4,tsl*0.3),Z);q.setFromAxisAngle(Y,hashI(i*3+j)*6.283);sc.set(H,H*(0.9+hashI(i+j*31)*0.2),H);m.compose(pos,q,sc);const v=0.82+hashI(i*19+j)*0.3;col.setRGB(TV.lin(lc[0]/255)*v,TV.lin(lc[1]/255)*v,TV.lin(lc[2]/255)*v);if(snowy)col.lerp(TV.snowC||(TV.snowC=new T.Color(0.72,0.75,0.8)),0.45);
   if(set.trunk)set.trunk.setMatrixAt(idx,m);if(set.leaf){set.leaf.setMatrixAt(idx,m);set.leaf.setColorAt(idx,col);}}}
 for(const L of ['near','far'])for(const k in this.protos){const set=this[L][k];for(const p of ['trunk','leaf']){const im=set[p];if(!im)continue;im.count=cnt[L][k];im.instanceMatrix.needsUpdate=true;if(im.instanceColor)im.instanceColor.needsUpdate=true;}}
 this.placeRocks();};
// boulders, pebbles, bushes, ferns, logs, stumps and lily pads around the player
V.placeRocks=function(){const T=this.tv.T,w=W,n=w.n,px=FP.px,pz=FP.pz,Tn2=this.tv.Town,built=Tn2.occupied||new Set(),season=w.season();
 const m=new T.Matrix4(),q=new T.Quaternion(),sc=new T.Vector3(),pos=new T.Vector3(),E=new T.Euler(),col=new T.Color();const C={rocks:0,pebbles:0,bushes:0,ferns:0,logs:0,stumps:0,lilies:0};
 const put=(mesh,key,x,y,z,sx,sy,sz,rx,ry,rz,r,g,b)=>{if(!mesh||C[key]>=mesh.instanceMatrix.count)return;pos.set(x,y,z);E.set(rx,ry,rz);q.setFromEuler(E);sc.set(sx,sy,sz);m.compose(pos,q,sc);mesh.setMatrixAt(C[key],m);if(r!==undefined){col.setRGB(r,g,b);mesh.setColorAt(C[key],col);}C[key]++;};
 const RR=70,RP=26,RF=32;const free=(X,Z,mg)=>!Tn2.onRoad(X,Z,mg)&&!(Tn2.blocked&&Tn2.blocked(X,Z));
 const shrubC=PXT.leafCol('shrub',0,season);
 for(let z=Math.max(1,pz-RR|0);z<=Math.min(n-2,pz+RR|0);z++)for(let x=Math.max(1,px-RR|0);x<=Math.min(n-2,px+RR|0);x++){const i=z*n+x,d=Math.hypot(x+0.5-px,z+0.5-pz);if(d>RR)continue;const b=w.biome[i];
  const wet=w.isWater(i);
  // lily pads on lakes and slow river edges
  if(wet){if(w.elev[i]>=0&&d<RF&&w.river[i]===2&&w.temp[i]>4&&vnoise(x/4,z/4,91)>0.55){const wh=TV.waterH(x+0.5,z+0.5);if(wh!==null)for(let j=0;j<6;j++){const X=x+hashI(i*3+j*7),Z=z+hashI(i*5+j*11),s=0.012+hashI(i+j*13)*0.018;put(this.lilies,'lilies',X,wh+0.003,Z,s,1,s,0,hashI(i*7+j)*6.28,0,0.16+hashI(j*3+i)*0.08,0.32+hashI(j+i*5)*0.12,0.08);}}continue;}
  if(w.lava[i]>0||built.has(i)||Tn2.fields&&Tn2.fields.has(i))continue;
  const f=w.forest[i],veg=w.veg[i],mtn=b===B.MOUNTAIN,sandy=b===B.DESERT||b===B.BEACH,cold=b===B.TUNDRA||b===B.SNOW,burnt=w.burnt[i]>0.4;
  let shore=false;for(const o of [1,-1,n,-n])if(w.isWater(i+o)&&w.elev[i+o]>=0){shore=true;break;}
  const cl=vnoise(x/6,z/6,17);// clustering: rocks and bushes gather in patches
  // boulders
  {const p=(mtn?0.75:sandy?0.18:cold?0.25:0.06)+(cl>0.7?0.25:0)+(shore?0.12:0);if(hashI(i*41)<p){const nn=mtn?2+(hashI(i*9)*2|0):1+(cl>0.75?2:0);for(let j=0;j<nn;j++){const X=x+hashI(i*43+j),Z=z+hashI(i*47+j);if(!free(X,Z,0.05))continue;const s=mtn?0.12+hashI(i*53+j)*0.5:0.05+hashI(i*53+j)*0.2;const l=0.75+hashI(i*59+j)*0.4;
    put(this.rocks,'rocks',X,FP.heightAt(X,Z)-s*0.25,Z,s,s*(0.7+hashI(i*61+j)*0.5),s*(0.8+hashI(i*7)*0.4),hashI(i+j)*0.4,hashI(i*3+j)*6.283,hashI(i*5+j)*0.4,l,l*0.97,l*0.93);}}}
  // pebbles and gravel underfoot, densest on bare, rocky and sandy ground and along banks
  if(d<RP){const np=Math.round((mtn?14:sandy?9:shore?12:cold?6:veg<0.3?6:2.5)*(0.4+cl));for(let j=0;j<np;j++){const X=x+hashI(i*67+j*3),Z=z+hashI(i*71+j*5);if(!free(X,Z,0.0))continue;const s=0.004+Math.pow(hashI(i*73+j),2.2)*0.022;const l=0.55+hashI(i*79+j)*0.5,wt=sandy?[1.05,0.95,0.8]:[1,0.97,0.92];
    put(this.pebbles,'pebbles',X,FP.heightAt(X,Z)-s*0.2,Z,s,s,s*(0.7+hashI(j*7+i)*0.6),0,hashI(i*83+j)*6.283,0,l*wt[0],l*wt[1],l*wt[2]);}}
  if(sandy||cold&&b===B.SNOW)continue;
  // bushes on open ground and at forest edges
  if(this.bushL&&!burnt&&veg>0.25){const p=(f>0.12&&f<0.5?0.45:f>=0.5?0.15:0.12+(cl>0.62?0.3:0))*veg;if(hashI(i*89)<p){const nb=1+(hashI(i*97)*3|0);for(let j=0;j<nb;j++){const X=x+hashI(i*101+j),Z=z+hashI(i*103+j);if(!free(X,Z,0.08))continue;const s=0.12+hashI(i*107+j)*0.14,v=0.75+hashI(i*109+j)*0.35;
    put(this.bushL,'bushes',X,FP.heightAt(X,Z)-0.02,Z,s,s*(0.7+hashI(i*113+j)*0.5),s,0,hashI(i*127+j)*6.283,0,TV.lin(shrubC[0]/255)*v,TV.lin(shrubC[1]/255)*v,TV.lin(shrubC[2]/255)*v);if(this.bushT){C.bushes--;put(this.bushT,'bushes',X,FP.heightAt(X,Z)-0.02,Z,s,s*(0.7+hashI(i*113+j)*0.5),s,0,hashI(i*127+j)*6.283,0);}}}}
  // ferns in the understorey of forests, jungles and wetlands
  if(d<RF&&!burnt&&(f>0.25||b===B.WETLAND||b===B.JUNGLE)&&!cold){const nf=Math.round((f>0.6?7:4)*(0.3+cl));for(let j=0;j<nf;j++){const X=x+hashI(i*131+j*3),Z=z+hashI(i*137+j*5);if(!free(X,Z,0.03))continue;const s=0.05+hashI(i*139+j)*0.06,v=0.7+hashI(i*149+j)*0.4,warm=b===B.JUNGLE?1.1:1;
    put(this.ferns,'ferns',X,FP.heightAt(X,Z)-0.004,Z,s,s*(0.8+hashI(j+i)*0.4),s,0,hashI(i*151+j)*6.283,0,0.12*v,0.26*v*warm,0.07*v);}}
  // fallen logs and stumps in woods (charred after a fire)
  if(f>0.35&&d<50){if(hashI(i*157)<0.07*f){const X=x+0.2+hashI(i*163)*0.6,Z=z+0.2+hashI(i*167)*0.6;if(free(X,Z,0.2)){const L=0.22+hashI(i*173)*0.35,r=0.012+hashI(i*179)*0.02,k=burnt?0.12:0.75;put(this.logs,'logs',X,FP.heightAt(X,Z)+r*0.6,Z,L,r,r,0,hashI(i*181)*6.283,0,k,k*0.92,k*0.85);}}
   if(hashI(i*191)<0.1*f){const X=x+hashI(i*193),Z=z+hashI(i*197);if(free(X,Z,0.05)){const r=0.014+hashI(i*199)*0.02,h=0.015+hashI(i*211)*0.03,k=burnt?0.1:0.8;put(this.stumps,'stumps',X,FP.heightAt(X,Z)-0.01,Z,r,h,r,0,hashI(i*223)*6.283,0,k,k*0.9,k*0.8);}}}}
 for(const [mesh,key] of [[this.rocks,'rocks'],[this.pebbles,'pebbles'],[this.bushL,'bushes'],[this.bushT,'bushes'],[this.ferns,'ferns'],[this.logs,'logs'],[this.stumps,'stumps'],[this.lilies,'lilies']]){if(!mesh)continue;mesh.count=Math.min(C[key],mesh.instanceMatrix.count);mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}};
// grass: density falls off smoothly with distance (no popping rings), reeds line the shores, flowers grow in meadow patches
V.placeGrass=function(){const T=this.tv.T,w=W,n=w.n,px=FP.px,pz=FP.pz,RG=12,cap=Math.min(this.tv.Q.grass,this.gcap);this.lastG=[px,pz];const Tn2=this.tv.Town,MM=1/11;
 const m=new T.Matrix4(),q=new T.Quaternion(),sc=new T.Vector3(),pos=new T.Vector3(),col=new T.Color(),Y=new T.Vector3(0,1,0);let c=0,fc=0;const ov=R.overlay;R.overlay='terrain';const cc=[0,0,0];
 const cells=[];for(let z=Math.max(1,pz-RG|0);z<=Math.min(n-2,pz+RG|0);z++)for(let x=Math.max(1,px-RG|0);x<=Math.min(n-2,px+RG|0);x++){const d=Math.hypot(x+0.5-px,z+0.5-pz);if(d<=RG)cells.push([x,z,d]);}cells.sort((a,b)=>a[2]-b[2]);
 const dens=Math.min(1,cap/36000),season=w.season(),FCOL=[[0.9,0.85,0.2],[0.85,0.2,0.3],[0.9,0.9,0.95],[0.6,0.3,0.85],[0.95,0.45,0.15],[0.35,0.45,0.95]];
 for(const [x,z,d] of cells){if(c>=cap)break;const i=z*n+x;const b=w.biome[i];if(w.isWater(i)||w.lava[i]>0||b===B.DESERT||b===B.BEACH||b===B.SNOW||w.snow[i]>0.5||w.elev[i]<0)continue;
  let shore=false;for(const o of [1,-1,n,-n])if(w.isWater(i+o)&&w.elev[i+o]>=0){shore=true;break;}
  const veg=w.veg[i];if(veg<0.12&&!shore)continue;
  {const g1=FP.heightAt(x+0.15,z+0.5),g2=FP.heightAt(x+0.85,z+0.5),g3=FP.heightAt(x+0.5,z+0.15),g4=FP.heightAt(x+0.5,z+0.85);if(Math.abs(g1-g2)+Math.abs(g3-g4)>0.8)continue;}
  const vt=w.vegType[i],crops=vt===9,reeds=vt===11||(shore&&hashI(i*29)<0.75),f=w.forest[i];
  const s=sstep(2,10,d),fall=360/(1+Math.pow(Math.max(0,d-2)/1.6,1.7))*clamp((RG-d)/2.5,0,1);
  const cover=clamp(Math.max(veg,shore?0.5:0)*1.25,0,1)*(1-f*0.55)*(b===B.TUNDRA||b===B.TAIGA?0.6:b===B.SAVANNA?0.8:1);
  for(const layer of (reeds&&!crops?[1,0]:[crops||reeds?1:0])){const rd=layer===1&&reeds&&!crops,cr=layer===1&&crops;
  const keep=cr?fall/360:rd?fall/360:1,per=cr?100:rd?60:Math.round(fall*cover*dens*(reeds?0.6:1));if(per<1||keep<=0)continue;
  TV.colorAt(i,cc,0);const burnt=w.burnt[i]>0.3;
  const hM=cr?0.7:rd?1.4:b===B.SAVANNA?0.8:b===B.TUNDRA?0.2:b===B.TAIGA?0.3:b===B.WETLAND?0.55:0.36;
  const s0=hashI(i*3),s1=hashI(i*3+1),meadow=vnoise(x/5,z/5,33),fcol=FCOL[(hashI((x/5|0)*977+(z/5|0)*131)*FCOL.length)|0];
  for(let j=0;j<per&&c<cap;j++){if((cr||rd)&&hashI(i*31+j)>keep)continue;let X,Z;if(cr){const row=j%10,t=((j/10)|0)/10;X=x+0.05+row*0.1;Z=z+0.03+t*0.94;}else{X=x+(((j+1)*0.7548776662+s0+layer*0.37)%1);Z=z+(((j+1)*0.5698402909+s1+layer*0.61)%1);}
   if(Tn2.blocked&&Tn2.blocked(X,Z))continue;if(Tn2.onRoad(X,Z,0.01))continue;
      const hv=hashI(i+j*3),hgt=hM*MM*(0.65+hv*0.7)*(1+0.3*s),wd=(cr?0.5:rd?0.42:0.62)*MM*(0.8+hashI(j*7+i)*0.5)*(1+0.9*s)*(burnt?0.8:1);
   pos.set(X,FP.heightAt(X,Z)-0.002,Z);q.setFromAxisAngle(Y,hashI(i*3+j*7)*6.283);sc.set(wd,hgt,wd);m.compose(pos,q,sc);this.grass.setMatrixAt(c,m);
   const v=0.78+hashI(i*5+j)*0.42,tn=1.5+0.45*s;if(cr){const k=season==='Autumn'||season==='Summer'?[0.62,0.48,0.15]:season==='Spring'?[0.2,0.42,0.1]:[0.32,0.26,0.16];col.setRGB(k[0]*v,k[1]*v,k[2]*v);}
   else if(burnt)col.setRGB(0.05,0.045,0.04);else if(rd)col.setRGB(0.16*v*tn*0.7,0.22*v*tn*0.7,0.08*v*tn*0.7);
   else{const dry=hashI(i*9+j*5)<0.1&&season!=='Spring';col.setRGB((dry?cc[0]*1.5+0.05:cc[0]*0.8)*v*tn,(dry?cc[1]*1.15+0.02:cc[1]*0.93)*v*tn,(dry?cc[2]*0.6:cc[2]*0.66)*v*tn);}this.grass.setColorAt(c,col);c++;
   const fp=vt===10?0.4:meadow>0.6&&season!=='Winter'?0.1*(meadow-0.6)/0.4+0.03:veg>0.5?0.01:0;
   if(!cr&&!rd&&fc<6000&&hashI(i*13+j*5)<fp){const fs=(0.07+hashI(j*7)*0.06)*MM;pos.y+=hgt*0.85;sc.set(fs,fs*0.7,fs);m.compose(pos,q,sc);this.flowers.setMatrixAt(fc,m);const fk=hashI(i*17+j)<0.75?fcol:FCOL[(i+j)%FCOL.length];col.setRGB(fk[0],fk[1],fk[2]);this.flowers.setColorAt(fc,col);fc++;}}}}
 R.overlay=ov;this.grass.count=c;this.grass.instanceMatrix.needsUpdate=true;if(this.grass.instanceColor)this.grass.instanceColor.needsUpdate=true;this.flowers.count=fc;this.flowers.instanceMatrix.needsUpdate=true;if(this.flowers.instanceColor)this.flowers.instanceColor.needsUpdate=true;};

// ============================================================
//  SHIPS: lofted hulls with sheer and a proper bow, decks, castles, masts, billowing sails, funnels,
//  containers and gun turrets by era; they ride the swell, trail a wake and smoke from their stacks
// ============================================================
TV.Ships={
 // L length, B beam, D draft, F freeboard (world units, 1 = 11 m), p section fullness (lower is boxier)
 def:{canoe:{L:0.45,B:0.08,D:0.03,F:0.03},sailboat:{L:0.8,B:0.22,D:0.07,F:0.07},cog:{L:1.4,B:0.45,D:0.14,F:0.16},galleon:{L:2.2,B:0.55,D:0.17,F:0.2},
  steamer:{L:2.6,B:0.42,D:0.15,F:0.16},trawler:{L:1.0,B:0.3,D:0.1,F:0.12},cargo:{L:4.5,B:0.7,D:0.22,F:0.2},warship:{L:3.8,B:0.45,D:0.16,F:0.14}},
 inst:[],
 init(tv){const T=tv.T;this.tv=tv;this.T=T;const hullM=new T.MeshStandardMaterial({vertexColors:true,roughness:0.7,metalness:0.05,side:T.DoubleSide});hullM.shadowSide=T.BackSide;
  const sailM=new T.MeshStandardMaterial({vertexColors:true,roughness:0.95,side:T.DoubleSide});const flagM=new T.MeshStandardMaterial({roughness:0.8,side:T.DoubleSide});
  this.M={};for(const k in this.def){const d=this.def[k],hb=new TVGB(),sb=new TVGB(),fb=new TVGB();this.build(k,d,hb,sb,fb);
   const mk=(gb,mat,cap)=>{if(!gb.v)return null;const g=gb.geo();g.computeVertexNormals();const m=new T.InstancedMesh(g,mat,cap);m.count=0;m.frustumCulled=false;m.castShadow=true;m.receiveShadow=true;tv.groups.life.add(m);return m;};
   this.M[k]={hull:mk(hb,hullM,48),sail:mk(sb,sailM,48),flag:mk(fb,flagM,48)};}
  const wake=tv.ctex('wake',128,256,(c,w,h)=>{c.fillStyle='#000';c.fillRect(0,0,w,h);const r=tvRnd(5);for(let k=0;k<900;k++){const t=r(),y=t*h,spread=8+t*(w/2-10),side=r()<0.5?-1:1,x=w/2+side*spread*(0.85+r()*0.2)+(r()-0.5)*6;const a=(1-t)*0.5;c.fillStyle=`rgba(255,255,255,${a})`;c.fillRect(x,y,2+r()*3,2+r()*3);}
   for(let k=0;k<700;k++){const t=r(),y=t*h,x=w/2+(r()-0.5)*(10+t*30);c.fillStyle=`rgba(255,255,255,${(1-t)*0.35})`;c.fillRect(x,y,2+r()*4,2+r()*4);}},{clamp:true});
  this.wake=new T.InstancedMesh(new T.PlaneGeometry(1,1).rotateX(-Math.PI/2),new T.MeshBasicMaterial({map:wake,transparent:true,depthWrite:false,blending:T.AdditiveBlending,color:0xffffff}),96);this.wake.count=0;this.wake.frustumCulled=false;this.wake.renderOrder=3;tv.groups.life.add(this.wake);
  this.m4=new T.Matrix4();this.q=new T.Quaternion();this.e=new T.Euler(0,0,0,'YZX');this.v=new T.Vector3();this.s=new T.Vector3(1,1,1);this.c=new T.Color();},
 // hull lofted from stations, waterline at y=0
 hull(gb,d,o){const T=TV.T,L=d.L,B=d.B,D=d.D,F=d.F,NS=16,K=10,p=o.p||0.6;const half=(t)=>{const st=o.transom||0.6;if(t<0.18)return B/2*(st+(1-st)*Math.sin(t/0.18*Math.PI/2));if(t<0.58)return B/2;const u=(t-0.58)/0.42;return B/2*Math.sqrt(Math.max(0,1-Math.pow(u,o.bowP||1.6)));};
  const sheer=(t)=>F*(1+(o.sheer===undefined?0.25:o.sheer)*(Math.pow(Math.max(0,(t-0.55)/0.45),2)*1.6+Math.pow(Math.max(0,(0.2-t)/0.2),2)*0.6));const keel=(t)=>D*(t>0.85?Math.max(0.2,1-(t-0.85)/0.15*0.8):1);
  const cl=(y)=>y<-0.004?o.bottom:y<F*0.16?o.boot:(o.band&&y>F*o.band[0]&&y<F*o.band[1]?o.bandC:o.top);
  const rings=[];for(let s=0;s<=NS;s++){const t=s/NS,x=-L/2+t*L,hb=half(t),top=sheer(t),dk=keel(t);const r=[];for(let k=0;k<=K;k++){const th=k/K*Math.PI,z=-Math.cos(th)*hb,y=top-(top+dk)*Math.pow(Math.sin(th),p);r.push([x,y,z]);}rings.push(r);}
  for(let s=0;s<NS;s++)for(let k=0;k<K;k++){const a=rings[s][k],b=rings[s+1][k],c=rings[s+1][k+1],e=rings[s][k+1];const i0=gb.v;for(const P of [a,b,c,e])gb.vert(P[0],P[1],P[2],0,1,0,0,0,cl(P[1]));gb.quad(i0,i0+3,i0+2,i0+1);}
  // transom
  {const r=rings[0],cy=(r[0][1]+r[K>>1][1])/2,c0=gb.vert(r[0][0],cy,0,-1,0,0,0,0,o.top);const i0=gb.v;for(const P of r)gb.vert(P[0],P[1],P[2],-1,0,0,0,0,cl(P[1]));for(let k=0;k<K;k++)gb.tri(c0,i0+k,i0+k+1);}
  // deck, a little below the rail so the hull has bulwarks
  for(let s=0;s<NS;s++){const a=rings[s][0],b=rings[s+1][0],c=rings[s+1][K],e=rings[s][K],dd=F*0.1;const i0=gb.v;for(const P of [a,b,c,e])gb.vert(P[0],P[1]-dd,P[2]*0.96,0,1,0,0,0,o.deck);gb.quad(i0,i0+1,i0+2,i0+3);}},
 bx(gb,x,y,z,w,h,d,c){gb.add(new TV.T.BoxGeometry(w,h,d),new TV.T.Matrix4().makeTranslation(x,y+h/2,z),c);},
 cy(gb,x,y,z,r,h,c,r1){gb.add(new TV.T.CylinderGeometry(r1===undefined?r:r1,r,h,10),new TV.T.Matrix4().makeTranslation(x,y+h/2,z),c);},
 rod(gb,a,b,r,c){const T=TV.T,A=new T.Vector3(...a),Bv=new T.Vector3(...b),L=A.distanceTo(Bv);const g=new T.CylinderGeometry(r,r,L,5);const q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),Bv.clone().sub(A).normalize());gb.add(g,new T.Matrix4().compose(A.clone().add(Bv).multiplyScalar(0.5),q,new T.Vector3(1,1,1)),c);},
 // square sail across the ship (billows forward) or a fore-and-aft sail along it
 sq(gb,x,y0,y1,w,bul,c){const N=5,b=gb.v;for(let v=0;v<=N;v++)for(let u=0;u<=N;u++){const U=u/N,Vv=v/N;gb.vert(x+bul*Math.sin(Math.PI*U)*Math.sin(Math.PI*(0.15+Vv*0.85)),y0+Vv*(y1-y0),(U-0.5)*w*(1-Vv*0.12),0,0,1,U,Vv,c);}for(let v=0;v<N;v++)for(let u=0;u<N;u++){const a=b+v*(N+1)+u;gb.quad(a,a+1,a+N+2,a+N+1);}},
 fa(gb,x0,x1,y0,y1,bul,c){const N=5,b=gb.v;for(let v=0;v<=N;v++)for(let u=0;u<=N;u++){const U=u/N,Vv=v/N,xx=x1+(x0-x1)*U*(1-Vv*0.85);gb.vert(xx,y0+Vv*(y1-y0),bul*Math.sin(Math.PI*U)*Math.sin(Math.PI*Vv*0.9),1,0,0,U,Vv,c);}for(let v=0;v<N;v++)for(let u=0;u<N;u++){const a=b+v*(N+1)+u;gb.quad(a,a+1,a+N+2,a+N+1);}},
 build(k,d,hb,sb,fb){const L=d.L,B=d.B,F=d.F,lin=(h)=>tvLinC(h),wood=lin('#6a4a2e'),dkw=lin('#3a2a1c'),tar=lin('#241c16'),cloth=lin('#e8e0cc'),white=lin('#e8e8e4'),grey=lin('#7c8288'),dark=lin('#2a2c30'),red=lin('#8a2a22'),black=lin('#1c1c1e');
  const flag=(x,y)=>{fb.vert(x,y,0,0,0,1,0,0);fb.vert(x-L*0.07,y,0,0,0,1,1,0);fb.vert(x-L*0.07,y+L*0.04,0,0,0,1,1,1);fb.vert(x,y+L*0.04,0,0,0,1,0,1);fb.quad(fb.v-4,fb.v-3,fb.v-2,fb.v-1);};
  if(k==='canoe'){this.hull(hb,d,{p:0.9,transom:0.05,bowP:1.3,sheer:0.6,top:wood,boot:wood,bottom:dkw,deck:dkw});return;}
  if(k==='sailboat'){this.hull(hb,d,{p:0.75,transom:0.5,top:lin('#d8d0bc'),boot:lin('#2a4a6a'),bottom:tar,deck:wood});this.rod(hb,[0.05,F,0],[0.05,F+0.7,0],0.008,dkw);this.rod(hb,[0.05,F+0.1,0],[-0.33,F+0.1,0],0.006,dkw);this.fa(sb,0.04,-0.32,F+0.1,F+0.68,0.04,cloth);flag(0.05,F+0.68);return;}
  if(k==='cog'||k==='galleon'){const g=k==='galleon';this.hull(hb,d,{p:0.6,transom:0.75,sheer:0.35,top:g?lin('#5a3a22'):wood,boot:tar,bottom:tar,deck:lin('#8a6a48'),band:g?[0.45,0.7]:null,bandC:lin('#c8a040')});
   this.bx(hb,-L*0.36,F*0.9,0,L*0.24,F*(g?1.3:0.9),B*0.86,g?lin('#5a3a22'):wood);if(g)this.bx(hb,-L*0.4,F*2.2,0,L*0.14,F*0.5,B*0.7,lin('#5a3a22'));this.bx(hb,L*0.36,F*0.95,0,L*0.12,F*0.5,B*0.5,wood);
   this.rod(hb,[L*0.5,F*1.1,0],[L*0.72,F*1.8,0],0.01,dkw);
   const masts=g?[[L*0.22,1.45],[-0.02,1.7],[-L*0.26,1.25]]:[[0,1.25]];for(const [mx,mh] of masts){this.rod(hb,[mx,F,0],[mx,F+mh,0],g?0.016:0.014,dkw);const sw=B*(g?1.5:1.7);
    this.rod(hb,[mx,F+mh*0.62,-sw/2],[mx,F+mh*0.62,sw/2],0.007,dkw);this.sq(sb,mx+0.01,F+mh*0.22,F+mh*0.6,sw,0.07,cloth);if(g){this.rod(hb,[mx,F+mh*0.95,-sw*0.38],[mx,F+mh*0.95,sw*0.38],0.006,dkw);this.sq(sb,mx+0.01,F+mh*0.64,F+mh*0.93,sw*0.76,0.05,cloth);}}
   flag(masts[0][0],F+masts[0][1]);if(g)flag(-L*0.47,F*2.8);return;}
  if(k==='steamer'){this.hull(hb,d,{p:0.5,transom:0.8,bowP:1.9,sheer:0.2,top:black,boot:white,bottom:red,deck:lin('#9a8a70')});this.bx(hb,-L*0.05,F,0,L*0.38,0.12,B*0.7,white);this.bx(hb,-L*0.02,F+0.12,0,L*0.22,0.09,B*0.56,white);this.bx(hb,L*0.08,F+0.21,0,L*0.06,0.06,B*0.6,lin('#3a4a5a'));
   for(const fx of [-L*0.04,-L*0.16]){this.cy(hb,fx,F+0.21,0,0.055,0.32,lin('#c84a2a'));this.cy(hb,fx,F+0.53,0,0.057,0.07,black);}this.rod(hb,[L*0.3,F,0],[L*0.3,F+0.75,0],0.008,dark);this.rod(hb,[-L*0.36,F,0],[-L*0.36,F+0.55,0],0.007,dark);flag(-L*0.36,F+0.55);return;}
  if(k==='trawler'){this.hull(hb,d,{p:0.55,transom:0.85,sheer:0.35,top:lin('#2a5a8a'),boot:white,bottom:red,deck:lin('#8a8a80')});this.bx(hb,L*0.12,F,0,L*0.26,0.13,B*0.7,white);this.bx(hb,L*0.12,F+0.13,0,L*0.2,0.035,B*0.72,lin('#2a3a4a'));
   this.rod(hb,[-L*0.42,F,-B*0.35],[-L*0.42,F+0.32,0],0.008,lin('#d8a020'));this.rod(hb,[-L*0.42,F,B*0.35],[-L*0.42,F+0.32,0],0.008,lin('#d8a020'));this.rod(hb,[L*0.12,F+0.16,0],[L*0.12,F+0.5,0],0.006,dark);this.rod(hb,[L*0.12,F+0.48,0],[-L*0.42,F+0.32,0],0.003,dark);flag(L*0.12,F+0.5);return;}
  if(k==='cargo'){this.hull(hb,d,{p:0.32,transom:0.95,bowP:2.4,sheer:0.12,top:lin('#2a3e5a'),boot:white,bottom:red,deck:lin('#6a6e70')});const CC=['#b83a2a','#2a5a9a','#3a8a4a','#d88a2a','#8a8e92','#e8e4dc','#6a3a8a','#c8b030'].map(lin);const r=tvRnd(41);
   for(let bay=0;bay<4;bay++)for(let row=-1;row<=1;row++){const st=1+((r()*2.2)|0);for(let s=0;s<st;s++)this.bx(hb,-L*0.18+bay*0.58,F+s*0.24,row*0.225,0.55,0.235,0.22,CC[(r()*CC.length)|0]);}
   const ax=-L*0.42;this.bx(hb,ax,F,0,0.42,0.62,B*0.86,white);this.bx(hb,ax,F+0.48,0,0.43,0.06,B*0.88,lin('#2a3a4a'));this.bx(hb,ax+0.02,F+0.62,0,0.36,0.04,B*1.02,white);this.cy(hb,ax-0.26,F,0,0.08,0.75,lin('#2a3a4a'));this.cy(hb,ax-0.26,F+0.75,0,0.082,0.06,black);this.rod(hb,[L*0.44,F,0],[L*0.44,F+0.35,0],0.008,white);flag(ax,F+0.95);this.rod(hb,[ax,F+0.66,0],[ax,F+0.95,0],0.005,dark);return;}
  if(k==='warship'){this.hull(hb,d,{p:0.6,transom:0.85,bowP:2.0,sheer:0.3,top:grey,boot:dark,bottom:red,deck:lin('#6a6e72')});
   this.bx(hb,-L*0.05,F,0,L*0.3,0.16,B*0.6,grey);this.bx(hb,0,F+0.16,0,L*0.15,0.14,B*0.5,grey);this.bx(hb,L*0.03,F+0.3,0,L*0.08,0.06,B*0.45,lin('#5a6066'));this.cy(hb,-L*0.14,F+0.16,0,0.06,0.22,grey);
   for(const [tx,dir] of [[L*0.28,1],[L*0.17,1],[-L*0.3,-1]]){this.cy(hb,tx,F,0,0.075,0.07,lin('#6a7076'));this.rod(hb,[tx+dir*0.04,F+0.05,-0.025],[tx+dir*0.3,F+0.06,-0.025],0.009,dark);this.rod(hb,[tx+dir*0.04,F+0.05,0.025],[tx+dir*0.3,F+0.06,0.025],0.009,dark);}
   this.rod(hb,[0,F+0.36,0],[0,F+0.9,0],0.01,dark);this.rod(hb,[0,F+0.75,-0.12],[0,F+0.75,0.12],0.005,dark);flag(-L*0.47,F+0.25);this.rod(hb,[-L*0.47,F,0],[-L*0.47,F+0.25,0],0.004,dark);}},
 pick(o){const s=SPECIES[o.sp],nm=(s&&s.n)||'';const home=o.home!==undefined?W.cityById(o.home):null;const civ=home?W.civById(home.civ):null;const era=civ?civ.era:/War/i.test(nm)?7:3;
  if(/War/i.test(nm))return era>=7?'warship':'galleon';if(/Fish/i.test(nm))return era<=1?'canoe':era>=7?'trawler':'sailboat';
  if(/Trad/i.test(nm))return era<=1?'canoe':era>=8?'cargo':era===7?'steamer':era>=5?'galleon':'cog';
  if(/Transport/i.test(nm))return era>=8?'cargo':era===7?'steamer':era>=5?'galleon':'cog';return era>=7?'steamer':'sailboat';},
 // sea surface height from the ocean shader's own wave set
 waveY(x,z){const tv=this.tv,ou=tv.oceanMat.uniforms,t=tv.U.uTime.value;const H=-tv.terrH(x,z);let amp=ou.uAmp.value*sstep(0,1.6,Math.max(0,H)*14/14*1.0);const cp=tv.cam.position;amp*=1-sstep(140,260,Math.hypot(x-cp.x,z-cp.z));let y=0;
  for(const w of ou.uWaves.value){const k=6.2832/w.w,c=Math.sqrt(TVG/k),l=Math.hypot(w.x,w.y)||1,f=k*((w.x*x+w.y*z)/l-c*t);y+=w.z/k*amp*Math.sin(f);}return y;},
 begin(){for(const k in this.M)for(const p in this.M[k]){const m=this.M[k][p];if(m)m.count=0;}if(this.wake)this.wake.count=0;},
 end(){for(const k in this.M)for(const p in this.M[k]){const m=this.M[k][p];if(m){m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;}}if(this.wake){this.wake.instanceMatrix.needsUpdate=true;if(this.wake.instanceColor)this.wake.instanceColor.needsUpdate=true;}},
 surf(x,z){const n=W.n,i=clamp(z|0,0,n-1)*n+clamp(x|0,0,n-1);if(W.elev[i]<0)return this.waveY(x,z);const h=TV.waterH(x,z);return h!==null?h:FP.waterTop(i);},
 put(ty,x,z,yaw,civ,id,sp,t){const M=this.M[ty],d=this.def[ty];if(!M||!M.hull)return;const y=this.surf(x,z),ca=Math.cos(yaw),sa=Math.sin(yaw);
  const yb=this.surf(x+ca*d.L*0.45,z+sa*d.L*0.45),ys=this.surf(x-ca*d.L*0.45,z-sa*d.L*0.45),yp=this.surf(x+sa*d.B*0.5,z-ca*d.B*0.5),yt=this.surf(x-sa*d.B*0.5,z+ca*d.B*0.5);
  const bob=Math.sin(t*1.3+id)*0.004,pitch=Math.atan2(yb-ys,d.L*0.9)*0.7+Math.sin(t*0.9+id*1.7)*0.01,roll=Math.atan2(yp-yt,d.B)*0.5+Math.sin(t*0.7+id)*0.02;
  this.e.set(roll,-yaw,pitch);this.q.setFromEuler(this.e);this.v.set(x,(y+yb+ys)/3+bob,z);this.m4.compose(this.v,this.q,this.s);
  for(const p of ['hull','sail','flag']){const m=M[p];if(!m||m.count>=m.instanceMatrix.count)continue;m.setMatrixAt(m.count,this.m4);if(p==='flag'){const cv=civ?W.civById(civ):null;const c=cv?hexToRgb(cv.color).map(v=>TV.lin(v/255)):[0.8,0.8,0.8];this.c.setRGB(c[0],c[1],c[2]);m.setColorAt(m.count,this.c);}m.count++;}
  // wake behind a moving ship
  if(sp>0.03&&this.wake.count<this.wake.instanceMatrix.count){const wl=Math.min(d.L*3,d.L*(0.8+sp*3)),ww=d.B*1.4+wl*0.3;this.q.setFromAxisAngle(this.v.set(0,1,0),-yaw-Math.PI/2);this.v.set(x-ca*(d.L*0.45+wl*0.5),y+0.006,z-sa*(d.L*0.45+wl*0.5));this.s.set(ww,1,wl);this.m4.compose(this.v,this.q,this.s);this.s.set(1,1,1);
   this.wake.setMatrixAt(this.wake.count,this.m4);const k=clamp(sp*3,0.15,0.7)*(0.3+0.7*R.daylight(W));this.c.setRGB(k,k,k);this.wake.setColorAt(this.wake.count,this.c);this.wake.count++;}
  // funnel smoke
  if((ty==='steamer'||ty==='cargo'||ty==='warship')&&Math.random()<0.05){const fx=ty==='cargo'?-d.L*0.42-0.26:ty==='steamer'?-d.L*0.1:-d.L*0.14,fy=ty==='cargo'?d.F+0.85:ty==='steamer'?d.F+0.6:d.F+0.4;this.tv.FX3.smokePuff(x+ca*fx,y+fy,z+sa*fx,{kind:'smoke',r:0.12,vy:0.5,life:7,grow:0.3,col:ty==='steamer'?[0.18,0.17,0.16]:[0.4,0.4,0.4],lo:true});}},
 add(o,t,self){const ty=(o._shipT&&t-o._shipTT<5)?o._shipT:(o._shipT=this.pick(o),o._shipTT=t,o._shipT);const home=o.home!==undefined?W.cityById(o.home):null;
  const x=self?FP.px:o._rx,z=self?FP.pz:o._rz,yaw=self?FP.yaw:o._ry;this.put(ty,x,z,yaw,home?home.civ:null,o.id||0,self?(FP.keys.size?0.25:0):(o._sp||0),t);},
 moored(t){const L=TV.Town.moored;if(!L)return;const cp=FP.px,cz=FP.pz,R2=Math.min(300,120*TV.lodR());for(const b of L){if(Math.abs(b.x-cp)>R2||Math.abs(b.z-cz)>R2)continue;this.put(b.type,b.x,b.z,b.yaw,b.civ,b.id,0,t);}}};

// ============================================================
//  TRAFFIC: carts, ox wagons and camel caravans in early eras, covered wagons later, cars and lorries in
//  the modern age, travelling the road network from town to town
// ============================================================
TV.Traffic={list:[],
 seed(P){this.list=[];let tot=0;const ok=P.filter(p=>p.era>=2&&p.len>1.2);for(const p of ok)tot+=p.len;if(!tot)return;const N=Math.min(40,Math.round(tot/5));
  for(let k=0;k<N;k++){let r=Math.random()*tot,p=ok[0];for(const q of ok){r-=q.len;if(r<=0){p=q;break;}}this.spawn(P.indexOf(p),Math.random()*p.len,k);}},
 kindFor(era,x,z){const b=W.biome[clamp(z|0,0,W.n-1)*W.n+clamp(x|0,0,W.n-1)];if(era>=7)return Math.random()<0.3?'truck':'car';if(era>=5)return Math.random()<0.6?'wagon':'cart';return b===B.DESERT||b===B.SAVANNA?'camel':'cart';},
 spawn(pi,s,id){const P=TV.Town.roadPaths[pi];const pt=P.pts[0];const kind=this.kindFor(P.era,pt[0],pt[1]);const sp={car:0.75,truck:0.55,wagon:0.1,cart:0.07,camel:0.08}[kind]*(0.8+Math.random()*0.4);
  const CC=['#b83a2a','#2a5a9a','#e8e4dc','#3a3c40','#8a8e92','#3a7a4a','#d8b030','#5a2a2a'];this.list.push({pi,s,dir:Math.random()<0.5?1:-1,kind,sp,id:id+Math.random()*1000,col:tvLinC(CC[(Math.random()*CC.length)|0]),seg:0});},
 at(P,s,v){const c=P.cum;let lo=0,hi=c.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(c[m]<=s)lo=m;else hi=m;}const a=P.pts[lo],b=P.pts[Math.min(lo+1,P.pts.length-1)],L=(c[lo+1]||c[lo])-c[lo]||1,t=clamp((s-c[lo])/L,0,1);v.x=a[0]+(b[0]-a[0])*t;v.z=a[1]+(b[1]-a[1])*t;const l=Math.hypot(b[0]-a[0],b[1]-a[1])||1;v.tx=(b[0]-a[0])/l;v.tz=(b[1]-a[1])/l;return v;},
 update(dt,t){const Tn2=TV.Town,P=Tn2.roadPaths;if(!P||!P.length){this.list.length=0;this.src=null;return;}
  // roads were rebuilt around the player: carry every vehicle over to the nearest point of the new network
  if(this.src!==P){const old=this.src;this.src=P;if(!old||!this.list.length)this.seed(P);else{const keep=[];for(const c of this.list){if(c.x===undefined)continue;let bd=0.6,bp=-1,bs=0;
     P.forEach((p,pi)=>{for(let k=0;k<p.pts.length;k++){const d=Math.hypot(p.pts[k][0]-c.x,p.pts[k][1]-c.z);if(d<bd){bd=d;bp=pi;bs=p.cum[k];}}});if(bp>=0){c.pi=bp;c.s=bs;keep.push(c);}}
    this.list=keep;if(keep.length<5)this.seed(P);}}
  const Lf2=TV.Life,v={},night=1-R.daylight(W);
  for(const c of this.list){let p=P[c.pi];if(!p)continue;c.s+=c.dir*c.sp*dt;
   if(c.s<0||c.s>p.len){// at the end of a road: carry on onto a connected one, or turn round
    const end=c.s>p.len?1:0,q=end?p.pts[p.pts.length-1]:p.pts[0],k=Math.round(q[0]*2)+','+Math.round(q[1]*2);const nx=(Tn2.roadEnds.get(k)||[]).filter(e=>e[0]!==c.pi);
    if(nx.length){const e=nx[(Math.random()*nx.length)|0];c.pi=e[0];p=P[c.pi];c.dir=e[1]?-1:1;c.s=e[1]?p.len:0;}else{c.dir*=-1;c.s=clamp(c.s,0,p.len);}}
   this.at(p,c.s,v);const fx=v.tx*c.dir,fz=v.tz*c.dir,side=(p.hw*0.45);const x=v.x-fz*side,z=v.z+fx*side;
   if(Math.abs(x-FP.px)>90||Math.abs(z-FP.pz)>90){c.x=x;c.z=z;continue;}const dk=Tn2.deckAt(x,z);const y=Math.max(dk!==null?dk:-1e9,TV.terrH(x,z)+0.012);
   c.x=x;c.z=z;const yaw=Math.atan2(fz,fx);this.draw(c,x,y,z,yaw,t,night);}},
 draw(c,x,y,z,yaw,t,night){const L=TV.Life;L.frame(x,y,z,yaw,1);const k=c.kind,wh=[0.08,0.07,0.07],wsp=t*c.sp*40;
  const wheel=(wx,wz,r)=>L.part('cyl',wx,r,wz,r,0.016,r,wh,Math.PI/2,wsp,0);
  const beast=(bx,camel)=>{const s=camel?1.25:1,ph=t*7+c.id;const col=camel?[0.62,0.48,0.3]:[0.32,0.22,0.15];L.part('sph',bx,0.09*s,0,0.075*s,0.045*s,0.035*s,col);if(camel)L.part('sph',bx,0.13,0,0.03,0.03,0.025,col);
   L.part('sph',bx+0.08*s,0.11*s,0,0.03*s,0.022*s,0.018*s,col);for(const [lx,lz,p] of [[0.045,0.022,0],[0.045,-0.022,3.1],[-0.045,0.022,3.1],[-0.045,-0.022,0]])L.part('cap',bx+lx*s,0.06*s,lz,0.014,0.06*s,0.014,col,0,0,Math.sin(ph+p)*0.4,0.03*s);};
  if(k==='car'){L.part('box',0,0.055,0,0.4,0.07,0.17,c.col);L.part('box',-0.03,0.115,0,0.22,0.06,0.15,[0.12,0.15,0.2]);for(const [wx,wz] of [[0.13,0.08],[0.13,-0.08],[-0.13,0.08],[-0.13,-0.08]])wheel(wx,wz,0.03);if(night>0.3)for(const sd of [-1,1])L.part('glow',0.2,0.06,sd*0.055,0.008,0.008,0.012,[3,2.8,2]);}
  else if(k==='truck'){L.part('box',0.24,0.07,0,0.14,0.13,0.18,c.col);L.part('box',0.24,0.12,0,0.1,0.05,0.185,[0.12,0.15,0.2]);L.part('box',-0.08,0.11,0,0.46,0.18,0.19,[0.82,0.8,0.76]);for(const [wx,wz] of [[0.25,0.09],[0.25,-0.09],[-0.15,0.09],[-0.15,-0.09],[-0.25,0.09],[-0.25,-0.09]])wheel(wx,wz,0.035);if(night>0.3)for(const sd of [-1,1])L.part('glow',0.315,0.06,sd*0.065,0.008,0.008,0.012,[3,2.8,2]);}
  else if(k==='wagon'){L.part('box',0,0.08,0,0.32,0.04,0.15,[0.42,0.3,0.18]);L.part('sph',0,0.11,0,0.17,0.1,0.085,[0.88,0.84,0.74]);for(const [wx,wz] of [[0.1,0.085],[0.1,-0.085],[-0.11,0.085],[-0.11,-0.085]])wheel(wx,wz,0.05);beast(0.32);beast(0.32+0.0);L.part('cyl',0.22,0.08,0,0.006,0.16,0.006,[0.3,0.2,0.1],0,0,Math.PI/2);}
  else if(k==='cart'){L.part('box',0,0.08,0,0.24,0.035,0.14,[0.45,0.32,0.2]);for(let s=0;s<3;s++)L.part('sph',-0.07+s*0.07,0.11,0,0.035,0.03,0.04,[[0.75,0.62,0.4],[0.6,0.5,0.32],[0.82,0.72,0.5]][s]);wheel(0,0.08,0.055);wheel(0,-0.08,0.055);L.part('cyl',0.2,0.07,0,0.005,0.16,0.005,[0.3,0.2,0.1],0,0,Math.PI/2);beast(0.32);}
  else if(k==='camel'){for(let q=0;q<3;q++){const bx=q*-0.22;beast(bx,true);L.part('box',bx,0.17,0,0.08,0.04,0.09,[[0.7,0.3,0.25],[0.3,0.4,0.6],[0.8,0.7,0.4]][q]);}}}};

// hook ships and traffic into the creature renderer
{const _init=Lf.init;Lf.init=function(tv){_init.call(this,tv);TV.Ships.init(tv);};
 const _draw=Lf.draw,_begin=Lf.begin,_end=Lf.end,_arm=Lf.armies;
 Lf.draw=function(o,t,self){if(o.prof===undefined){const s=SPECIES[o.sp];if(s&&s.shape==='boat'){try{TV.Ships.add(o,t,self);}catch(e){console.warn(e);}return;}}return _draw.call(this,o,t,self);};
 Lf.begin=function(){_begin.call(this);if(TV.Ships.M)TV.Ships.begin();};
 Lf.end=function(){_end.call(this);if(TV.Ships.M)TV.Ships.end();};
 Lf.armies=function(dt,t){_arm.call(this,dt,t);try{if(TV.Ships.M)TV.Ships.moored(t);TV.Traffic.update(dt,t);}catch(e){console.warn(e);}};}
})();
