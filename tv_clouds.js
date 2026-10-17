'use strict';
// ============================================================
//  3D CLOUD ENGINE (loaded after tv_rework.js)
//
//  PART A  volumetric storms and volcanic plumes
//   - cumulonimbus: a rising updraft tower whose cauliflower billows boil upward, a glaciated top, a flat
//     tropopause anvil that spreads downwind with mammatus pouches and an overshooting dome, a rain shaft
//     with streaks, a ragged base and (on supercells) a rotating wall cloud
//   - plinian eruption columns: gas-thrust jet, entraining billowing cone, mushroom head, a neutral-buoyancy
//     umbrella plateau that spreads as a gravity current, ash fallout curtains, ground-hugging pyroclastic
//     skirts, lava glow at the vent and volcanic lightning
//   - both are ray-marched analytic density fields (3D noise displaced by an updraft model), lit with
//     multiple-scattering sun light, depth-tested against the world, and driven by a small physics model
//     (buoyant rise, entrainment, tropopause spreading, precipitation loading, dissipation)
//  PART B  the sky cloud layers (cumulus, altocumulus, cirrus) and cloud shadows on the ground
// ============================================================
(function(){
if(typeof TV==='undefined'||typeof FP==='undefined')return;
const sstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};

// ------------------------------------------------------------
//  shader
// ------------------------------------------------------------
const VOL_VS=`#include <common>
 #include <logdepthbuf_pars_vertex>
 varying vec3 vWP;
 void main(){vec4 wp=modelMatrix*vec4(position,1.);vWP=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;
 #include <logdepthbuf_vertex>
 }`;
const VOL_FS=`precision highp float;precision highp sampler3D;
 #include <common>
 #include <logdepthbuf_pars_fragment>
 uniform sampler3D uNoise3;
 uniform vec3 uSun,uSunCol,uAmb,uHor,uZen,uFogCol,uBMin,uBMax,uAlb,uGround;
 uniform float uDay,uFogD,uSteps,uTime,uK,uLS,uMaxStep,uDark;
 uniform vec4 uA,uB,uC,uD,uE,uF,uG;
 varying vec3 vWP;
 float sstep(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
 vec2 rot2(vec2 v,float a){float c=cos(a),s=sin(a);return vec2(c*v.x-s*v.y,s*v.x+c*v.y);}
 float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
 float N1(vec3 q){return texture(uNoise3,q).r;}
 float N2(vec3 q){return texture(uNoise3,q).g;}
 float hg(float c,float g){float g2=g*g;return (1.-g2)/(4.*3.14159*pow(1.+g2-2.*g*c,1.5));}
 // downwind lean of the column with height
 float leanAt(float h){float t=clamp(h/max(uB.w,1.),0.,1.);return uD.z*uB.w*(t*t*0.85+t*0.15);}

 // ---------------- cumulonimbus ----------------
 // cls.x = ice (glaciated, fibrous), cls.y = precipitation
 float cbDens(vec3 p,int lod,out vec2 cls){
  cls=vec2(0.);
  vec3 r=p-uA.xyz;float h=r.y;
  float H=uB.x,R0=uB.y,Ra=uB.z,ha=uB.w,Ta=uC.x,mat=uC.z,age=uC.w,tk=uE.z;
  vec2 wd=uD.xy;float f0=uG.x;float d=0.;
  // updraft tower: widens with height, cauliflower head, narrows to a dome above the anvil
  float tp=clamp(h/H,0.,1.);
  vec2 dx=r.xz-wd*leanAt(h);float rr=length(dx);
  float rad=R0*(0.9+0.26*pow(clamp(h/ha,0.,1.),0.8))*tk*(1.+0.22*sstep(0.5,1.,tp)*mat);
  rad*=1.-0.5*sstep(ha-Ta*0.5,ha+Ta*0.3,h);
  float capH=max(rad*0.9,1.);
  if(h>H-capH){float k=(h-(H-capH))/capH;rad*=sqrt(max(0.,1.-k*k));}
  if(h>-10.&&h<H&&rr<rad*1.8&&rad>1.){
   vec2 dr=rot2(dx,uE.x*age*(0.3+0.7*tp));
   // billow noise is carried up with the updraft, so turrets visibly rise and boil
   vec3 bq=vec3(dr.x,h-age*uE.y,dr.y)*f0;
   float big=N1(bq*0.38+vec3(0.13,0.,0.41)),lump=N1(bq),bub=N2(bq*1.1+vec3(0.37,0.11,0.53));
   float amp=0.25+0.6*sstep(0.08,0.7,tp);
   float sdf=rr/(rad*(1.+clamp(((big-0.5)*2.6+(lump-0.5)*2.0+(bub-0.5)*1.5)*amp,-0.5,0.9)));
   float base=clamp((1.-sdf)*7.,0.,1.);
   if(base>0.){
    float ice=sstep(0.45,0.85,h/ha);
    float er=0.;if(lod==0)er=(1.-N2(bq*2.3+vec3(0.71,0.29,0.13)))*0.3*(1.-0.5*ice);
    d=clamp(base-er*(1.-base*0.4),0.,1.)*sstep(-6.,12.+22.*lump,h);
    cls.x=ice;
   }
  }
  // anvil: flat spreading plate at the tropopause, drifting downwind, mammatus pouches underneath
  if(Ra>8.){
   float ay=h-(ha-Ta);
   if(ay>-Ta*0.45&&ay<Ta*1.1){
    vec2 dA=r.xz-wd*(leanAt(ha)+0.3*Ra);
    float al=dot(dA,wd),pp=dot(dA,vec2(-wd.y,wd.x));
    float rd2=length(vec2(al/(al>0.?Ra*0.74:Ra*0.4),pp/(Ra*0.72)));
    if(rd2<1.3){
     vec3 aq=vec3(al*0.5,ay*1.3,pp*1.5)*f0*0.5+vec3(0.,0.,age*0.004);
     float fib=N1(aq);
     float edge=1.-sstep(0.5,1.0+(fib-0.5)*0.55,rd2);
     float thick=Ta*(0.45+0.55*sstep(1.,0.15,rd2));
     float mam=N2(vec3(dA.x,0.31,dA.y)*f0*1.2);
     float bot=Ta-thick-Ta*0.34*mam*mam*mat*sstep(0.95,0.25,rd2);
     float da=edge*sstep(bot,bot+Ta*0.14,ay)*sstep(Ta,Ta*0.78,ay)*(0.55+0.7*fib);
     if(lod==0)da=clamp(da-(1.-N2(aq*3.2+0.3))*0.3,0.,1.);
     d=d+da-d*da;cls.x=max(cls.x,da);
    }
   }
  }
  // rain shaft: streaky grey curtain below the base, slanting downwind, widening toward the ground
  if(lod==0&&uD.w>0.01&&h<8.){
   float gAGL=uG.z;
   vec2 dS=r.xz-(rot2(wd,0.55)*R0*0.8+wd*max(0.,-h)*0.22);
   float Rs=R0*(0.5+0.4*sstep(0.,gAGL,-h));
   float rsd=length(dS)/Rs;
   if(rsd<1.3){
    float sn=N1(vec3(dS.x,h*0.16+age*0.5,dS.y)*f0*3.);
    float rd=uD.w*sstep(1.,0.25,rsd)*(0.25+0.9*sn)*sstep(-gAGL-4.,-gAGL+18.,h)*sstep(8.,-6.,h)*0.55;
    d=d+rd-d*rd;cls.y=max(cls.y,rd/(d+0.01));
   }
  }
  // wall cloud: lowered rotating pedestal under the updraft
  if(lod==0&&uG.w>0.5&&h<6.){
   float dep=36.*uG.w;
   vec2 dw=r.xz-wd*leanAt(0.)-rot2(wd,-0.4)*R0*0.15;
   float rw=length(dw)/(R0*0.4);
   if(rw<1.4&&h>-dep-8.){
    vec3 wq=vec3(rot2(dw,uE.x*age*2.),h-age*3.).xzy;
    float wl=N1(vec3(wq.x,wq.z,wq.y)*f0*1.6);
    float wc=sstep(1.,0.45,rw+(wl-0.5)*0.5)*sstep(-dep,-dep+16.,h+(wl-0.5)*12.)*sstep(6.,0.,h);
    d=d+wc-d*wc;
   }
  }
  return d*uC.y;
 }

 // ---------------- volcanic plume ----------------
 // uB: x front height, y vent radius, z umbrella radius, w neutral-buoyancy height
 // uE.w: lower cut (a detached plume lifts off the vent); uG.z/w: pyroclastic skirt radius / height
 float plDens(vec3 p,int lod,out vec2 cls){
  cls=vec2(0.);
  vec3 r=p-uA.xyz;float h=r.y;
  float H=uB.x,R0=uB.y,Ra=uB.z,hb=uB.w,Ta=uC.x,mat=uC.z,age=uC.w,cut=uE.w;
  vec2 wd=uD.xy;float f0=uG.x;float d=0.;
  float tp=clamp(h/H,0.,1.),hr=h/max(H,1.);
  vec2 ax=wd*leanAt(h)+vec2(sin(h*0.019+age*0.15),cos(h*0.023-age*0.11))*R0*0.5*sstep(0.1,0.6,tp);
  vec2 dx=r.xz-ax;float rr=length(dx);
  // gas-thrust jet, then an entraining cone, with a bulbous billowing head just under the rising front
  float rad=R0*(0.8+0.9*sstep(0.,0.1,hr))+0.29*h*(0.45+0.55*sstep(0.03,0.4,hr));
  float hd=0.2*H;float hk=clamp((h-(H-hd))/hd,0.,1.);
  rad*=1.+0.9*sin(hk*3.14159)*sstep(0.2,0.8,mat);
  rad*=1.-0.45*sstep(hb-Ta*0.3,hb+Ta*0.5,h)*step(0.001,Ra);
  rad*=uE.z;
  float capH=max(rad,1.);
  if(h>H-capH){float k=(h-(H-capH))/capH;rad*=sqrt(max(0.,1.-k*k));}
  if(h>cut-5.&&h<H&&rr<rad*1.9&&rad>1.){
   vec2 dr=rot2(dx,0.0035*h*uE.x);
   vec3 bq=vec3(dr.x,h-age*uE.y,dr.y)*f0;
   float lump=N1(bq),bub=N2(bq*1.1+vec3(0.37,0.11,0.53));
   float amp=0.16+0.34*sstep(0.04,0.5,hr);
   float sdf=rr/(rad*(1.+clamp(((lump-0.5)*2.4+(bub-0.5)*1.8)*amp,-0.5,0.9)));
   float base=clamp((1.-sdf)*6.,0.,1.);
   if(base>0.){
    float er=0.;if(lod==0)er=(1.-N2(bq*2.3+vec3(0.71,0.29,0.13)))*0.16;
    d=clamp(base-er*(1.-base*0.5),0.,1.)*sstep(cut-4.,cut+18.,h);
    cls.x=sstep(0.4,0.9,hr)*0.5;
   }
  }
  // umbrella plateau at the level of neutral buoyancy: flat, lobed, billowing top and lumpy underside
  if(Ra>8.){
   float az=h-(hb-Ta);
   if(az>-Ta*0.5&&az<Ta*1.25){
    vec2 dA=r.xz-wd*(leanAt(hb)+0.2*Ra);
    float ang=atan(dA.y,dA.x);
    float lob=1.+0.14*sin(ang*3.+age*0.03)+0.09*sin(ang*7.+1.7);
    float rd2=length(dA)/(Ra*lob);
    if(rd2<1.3){
     vec3 uq=vec3(dA.x,az*1.5,dA.y)*f0*0.55;
     float lu=N1(uq),bu=N2(uq*1.2+0.4);
     float edge=1.-sstep(0.55,1.0+(lu-0.5)*0.35,rd2);
     float thick=Ta*(0.5+0.5*sstep(1.,0.2,rd2));
     float top=Ta*(0.92+0.14*(bu-0.5));
     float bot=Ta-thick+Ta*0.22*(bu-0.3)*sstep(0.95,0.2,rd2);
     float da=edge*sstep(bot,bot+Ta*0.16,az)*sstep(top,top-Ta*0.2,az)*(0.6+0.6*lu);
     if(lod==0)da=clamp(da-(1.-N2(uq*3.4+0.3))*0.3,0.,1.);
     d=d+da-d*da;cls.x=max(cls.x,da*0.7);
    }
   }
  }
  // ash fallout: slanting curtains under the umbrella
  if(lod==0&&uD.w>0.01&&h>3.&&h<hb-Ta*0.5){
   vec2 dF=r.xz-wd*(leanAt(hb)+0.35*Ra)+wd*(hb-h)*0.35;
   float rf=length(dF)/(Ra*0.75);
   if(rf<1.3){
    float sn=N1(vec3(dF.x,h*0.12,dF.y)*f0*1.6);
    float fa=uD.w*sstep(1.,0.4,rf)*(0.12+0.8*sn*sn)*sstep(3.,hb*0.4,h)*sstep(hb-Ta*0.5,hb-Ta*1.2,h)*0.6;
    d=d+fa-d*fa;cls.y=max(cls.y,fa/(d+0.01));
   }
  }
  // pyroclastic skirt: ground-hugging boiling flow, lobed, with rolling billows on its top
  if(uG.z>1.){
   float R=uG.z,hp=uG.w;float r2=length(r.xz);
   if(r2<R*1.3&&h<hp*2.5){
    float ang=atan(r.z,r.x);
    float lim=R*(0.75+0.3*sin(ang*3.+1.3)+0.2*sin(ang*7.));
    vec3 sq=vec3(r.x,h-age*2.,r.z)*f0*1.4;
    float sl=N1(sq),sb=N2(sq*3.1+0.2);
    float ht=hp*(1.-0.7*r2/max(lim,1.))*(0.8+0.8*(sl-0.4));
    float sk=sstep(1.05,0.7,r2/max(lim,1.))*sstep(ht,ht*0.45,h)*sstep(-2.,3.,h)*(0.6+0.6*sb);
    d=d+sk-d*sk;cls.y=max(cls.y,0.);
   }
  }
  return d*uC.y;
 }

 // cheap analytic bounds of everything the density functions can produce, so empty space costs no texture reads
 bool inBoundsCb(vec3 p){
  vec3 r=p-uA.xyz;float h=r.y;float H=uB.x,R0=uB.y,Ra=uB.z,ha=uB.w,Ta=uC.x;vec2 wd=uD.xy;
  if(h>-10.&&h<H+4.&&length(r.xz-wd*leanAt(h))<R0*1.95)return true;
  if(Ra>8.&&h>ha-Ta*1.5&&h<ha+Ta*0.2&&length(r.xz-wd*(leanAt(ha)+0.3*Ra))<Ra*1.0)return true;
  if(uD.w>0.01&&h<8.&&h>-uG.z-6.&&length(r.xz-(rot2(wd,0.55)*R0*0.8+wd*max(0.,-h)*0.22))<R0*1.2)return true;
  return false;}
 bool inBoundsPl(vec3 p){
  vec3 r=p-uA.xyz;float h=r.y;float H=uB.x,R0=uB.y,Ra=uB.z,hb=uB.w,Ta=uC.x;vec2 wd=uD.xy;
  if(h>uE.w-6.&&h<H+4.&&length(r.xz-wd*leanAt(h))<(R0*1.8+0.22*h+0.8*R0)*1.45)return true;
  if(Ra>8.&&h>hb-Ta*1.6&&h<hb+Ta*0.4&&length(r.xz-wd*(leanAt(hb)+0.2*Ra))<Ra*1.4)return true;
  if(uD.w>0.01&&h>2.&&h<hb&&length(r.xz-wd*(leanAt(hb)+0.35*Ra)+wd*(hb-h)*0.35)<Ra*1.0)return true;
  if(uG.z>1.&&h<uG.w*2.6&&length(r.xz)<uG.z*1.4)return true;
  return false;}
 bool inBounds(vec3 p){return uA.w<0.5?inBoundsCb(p):inBoundsPl(p);}
 float DENS(vec3 p,int lod,out vec2 cls){if(uA.w<0.5)return cbDens(p,lod,cls);return plDens(p,lod,cls);}

 void main(){
  vec3 ro=cameraPosition,rd=normalize(vWP-ro);
  vec3 inv=1./rd,ta=(uBMin-ro)*inv,tb=(uBMax-ro)*inv;vec3 tn=min(ta,tb),tf=max(ta,tb);
  float t0=max(max(max(tn.x,tn.y),tn.z),0.),t1=min(min(tf.x,tf.y),tf.z);
  if(t1<=t0)discard;
  int N=int(uSteps);
  float dither=hash12(gl_FragCoord.xy+fract(uTime*1.7)*53.);
  float cs=dot(rd,uSun);
  bool plume=uA.w>0.5;
  float Hc=max(plume?uB.w:uB.x,50.);
  vec3 acc=vec3(0.);float T=1.;float tHit=-1.;
  float dt0=clamp(0.007*t0+1.,1.,uMaxStep);
  float t=t0+dither*dt0;
  vec3 skyAmbTop=uZen*0.95+uHor*0.15+vec3(0.05);
  vec3 skyAmbBot=uHor*0.4+uGround*0.3+vec3(0.02);
  int ns=0;
  for(int i=0;i<320;i++){
   if(ns>=N||t>t1||T<0.02)break;
   vec3 p=ro+rd*t;
   if(!inBounds(p)){t+=clamp(0.02*t+5.,5.,uMaxStep*1.1);continue;}
   ns++;
   float dt=clamp(0.007*t+1.,1.,uMaxStep);
   vec2 cls;float d=DENS(p,0,cls);
   if(d>0.004){
    // optical depth toward the sun (four growing steps of the coarse field)
    float od=0.;vec3 lp=p;vec2 c2;
    float j0=0.7+0.6*hash12(gl_FragCoord.yx*1.3+t);
    od+=DENS(lp+uSun*uLS*0.7*j0,1,c2)*uLS*0.7;
    od+=DENS(lp+uSun*uLS*2.0*j0,1,c2)*uLS*1.3;
    od+=DENS(lp+uSun*uLS*4.6*j0,1,c2)*uLS*2.6;
    od+=DENS(lp+uSun*uLS*9.6*j0,1,c2)*uLS*5.;
    od*=uK;
    float uo=DENS(p+vec3(0.,uLS*1.5,0.),1,c2)*1.5+DENS(p+vec3(0.,uLS*4.5,0.),1,c2)*3.+DENS(p+vec3(0.,uLS*10.,0.),1,c2)*5.5;
    float ao=exp(-uo*uK*uLS*0.4);
    float hh=clamp((p.y-uA.y)/Hc,0.,1.);
    // multiple scattering: successive octaves of the sun transmittance, wider and dimmer
    float sunT=exp(-od)+0.25*exp(-od*0.3)+0.1*exp(-od*0.09);
    float ph=0.5+1.1*pow(max(cs,0.),6.)+0.25*pow(max(-cs,0.),3.);
    float powder=1.-exp(-d*uK*dt*2.2);
    vec3 sunL=uSunCol*sunT*ph*(0.5+0.5*powder)*0.5;
    vec3 ambL=mix(skyAmbBot,skyAmbTop,0.2+0.8*hh)*ao;
    // dusk and dawn tint the sunlit sides
    float dusk=clamp(1.-abs(uSun.y)*3.5,0.,1.);
    ambL+=vec3(0.9,0.38,0.2)*dusk*0.14*(0.4+0.6*hh);
    vec3 alb=mix(uAlb,uAlb*vec3(0.62,0.7,0.8),cls.y);
    vec3 col=alb*(sunL+ambL*(1.-uDark*0.5));
    // ice crystals scatter a touch brighter and bluer
    col=mix(col,col*vec3(1.05,1.08,1.12)+uAmb*0.1,cls.x*0.5);
    // lava glow at the vent, volcanic and in-cloud lightning
    if(plume){float gl=exp(-(p.y-uA.y)/(0.09*uB.x+10.))*uG.y;col+=vec3(1.,0.34,0.07)*gl*d*4.5;}
    float fd=length(p-uF.xyz);
    col+=vec3(0.72,0.8,1.)*uF.w*exp(-fd/(uB.y*1.1+30.))*d*3.2;
    // distance haze, thinning with altitude
    float ff=(1.-exp(-uFogD*uFogD*t*t))*exp(-max(0.,p.y)*0.0045);
    col=mix(col,uFogCol,clamp(ff*0.6,0.,1.));
    float a=1.-exp(-d*uK*dt);
    acc+=T*a*col;T*=1.-a;
    if(tHit<0.&&(1.-T)>0.04)tHit=t;
    t+=dt;
   }else t+=dt*1.7;
  }
  if(tHit<0.)tHit=t0;
  vec3 hp=ro+rd*tHit;
  float vz=-(viewMatrix*vec4(hp,1.)).z;
  gl_FragDepth=log2(1.+max(vz,0.01))*logDepthBufFC*0.5;
  gl_FragColor=vec4(acc,1.-T);
 }`;

// ------------------------------------------------------------
//  the volume manager
// ------------------------------------------------------------
const Vol=TV.Vol={list:[],ready:false,
 init(tv){const T=tv.T;this.tv=tv;this.geo=new T.BoxGeometry(1,1,1);this.ready=true;this.fogCol=tv.scene.fog.color;this.ground=new T.Color(0.18,0.2,0.14);},
 mat(){const T=this.T||(this.T=this.tv.T),U=this.tv.U;
  const m=new T.ShaderMaterial({vertexShader:VOL_VS,fragmentShader:VOL_FS,transparent:true,depthWrite:false,depthTest:true,side:T.BackSide,
   blending:T.CustomBlending,blendSrc:T.OneFactor,blendDst:T.OneMinusSrcAlphaFactor,blendSrcAlpha:T.OneFactor,blendDstAlpha:T.OneMinusSrcAlphaFactor,
   uniforms:{uNoise3:U.uNoise3,uSun:U.uSun,uSunCol:U.uSunCol,uAmb:U.uAmb,uHor:U.uHor,uZen:U.uZen,uDay:U.uDay,uTime:U.uTime,uFogCol:{value:this.fogCol},uFogD:{value:0.0007},uGround:{value:this.ground},
    uBMin:{value:new T.Vector3()},uBMax:{value:new T.Vector3()},uAlb:{value:new T.Color(1,1,1)},uSteps:{value:48},uK:{value:0.07},uLS:{value:14},uMaxStep:{value:22},uDark:{value:0},
    uA:{value:new T.Vector4()},uB:{value:new T.Vector4()},uC:{value:new T.Vector4()},uD:{value:new T.Vector4()},uE:{value:new T.Vector4()},uF:{value:new T.Vector4()},uG:{value:new T.Vector4()}}});
  return m;},
 add(obj){const T=this.tv.T;obj.m=this.mat();obj.mesh=new T.Mesh(this.geo,obj.m);obj.mesh.frustumCulled=false;obj.mesh.renderOrder=4;this.tv.groups.fx.add(obj.mesh);this.list.push(obj);return obj;},
 remove(obj){const i=this.list.indexOf(obj);if(i>=0)this.list.splice(i,1);this.tv.groups.fx.remove(obj.mesh);obj.m.dispose();},
 clear(){for(const o of this.list.slice())this.remove(o);},
 // write one volume's parameters to its shader and size its bounding box
 sync(o){const m=o.m,u=m.uniforms,Q=this.tv.Q;const T=this.T;
  u.uA.value.set(o.x,o.oy,o.z,o.type==='plume'?1:0);u.uB.value.set(o.H,o.R0,o.Ra,o.ha);u.uC.value.set(o.Ta,o.fade,o.mat,o.age);u.uD.value.set(o.wd[0],o.wd[1],o.shear,o.rain);
  u.uE.value.set(o.spin,o.rise,o.tk,o.cut||0);u.uF.value.set(o.fx,o.fy,o.fz,o.flash);u.uG.value.set(o.f0,o.glow||0,o.type==='plume'?(o.skirtR||0):o.agl,o.type==='plume'?(o.skirtH||0):(o.wall||0));
  u.uK.value=o.K;u.uLS.value=o.ls;u.uAlb.value.setRGB(o.alb[0],o.alb[1],o.alb[2]);u.uMaxStep.value=o.maxStep;u.uDark.value=this.tv.U.uCloudDark.value;
  u.uSteps.value=clamp(Math.round(Q.clouds*1.4+36),56,112);u.uFogD.value=this.tv.scene.fog.density;
  // bounding box: ground to the top of everything, wide enough for the anvil or umbrella and the lean
  const lean=o.shear*o.ha,ext=Math.max(o.R0*2.2,(o.Ra>8?o.Ra*1.35+Math.abs(lean)+o.Ra*0.3:0)+o.R0*1.5,o.skirtR*1.35||0),yTop=o.oy+Math.max(o.H,o.ha)+o.Ta*0.5+40,yBot=o.type==='plume'?o.oy-8:o.oy-o.agl-6;
  u.uBMin.value.set(o.x-ext,yBot,o.z-ext);u.uBMax.value.set(o.x+ext,yTop,o.z+ext);
  o.mesh.position.set(o.x,(yBot+yTop)/2,o.z);o.mesh.scale.set(ext*2,yTop-yBot,ext*2);
  o.mesh.visible=o.fade>0.01;},
};

// ------------------------------------------------------------
//  weather helpers
// ------------------------------------------------------------
const windVec=()=>{const w=TV.U.uWind.value;return [w.x,w.z];};
const windDir=()=>{const [x,z]=windVec();const l=Math.hypot(x,z)||1;return [x/l,z/l];};

// ------------------------------------------------------------
//  CUMULONIMBUS physics
// ------------------------------------------------------------
// Each cell is a small thermodynamic model: a buoyant updraft climbs (dH/dt = w) until it reaches the tropopause,
// where it overshoots and spreads into an anvil; hydrometeors load the updraft, precipitation starts above the
// freezing level and drags a downdraft; later the updraft dies, the tower collapses and only the anvil is left.
const Cb={cells:[],
 make(o){const i=clamp(o.i===undefined?0.6:o.i,0.2,1),sd=o.seed||Math.random()*1e3,rnd=tvRnd((sd*977)|0);
  const ha=300+150*i+rnd()*50,R0=clamp(0.26*ha+((o.r||8)-8)*2.5,92,150)*(0.9+rnd()*0.2);
  const c={type:'cb',x:o.x,z:o.z,oy:0,agl:46+rnd()*26,ground:0,i,seed:sd,ha,R0,Ta:ha*0.13,RaMax:ha*(1.1+0.35*rnd())+110*i,Ra:0,H:ha*0.07,age:o.age||0,tGrow:34+26*(1-i),tDec:0,dec:0,mat:0,rain:0,fade:1,tk:1,wd:[1,0],shear:0.2,spin:(rnd()<0.5?-1:1)*(0.05+0.08*i),rise:6+4*i,f0:1/(R0*2.6),K:0.07,ls:ha*0.045,maxStep:12,alb:[1,1,1],flash:0,fx:0,fy:0,fz:0,wall:0,
   w:0,kind:o.kind||'cell',dis:o.dis||null,lightT:2+Math.random()*4,anchored:!!o.dis};
  c.tDec=c.tGrow+60+50*i;c.life=c.tDec+80;
  if(o.kind==='ambient'){c.age=c.tGrow*0.9+Math.random()*30;c.tDec=c.age+80+Math.random()*80;c.life=c.tDec+80;}
  return c;},
 spawn(o){const c=this.make(o);this.cells.push(c);Vol.add(c);this.ground(c);return c;},
 ground(c){c.ground=TV.terrH(clamp(c.x,1,W.n-2),clamp(c.z,1,W.n-2));c.oy=Math.max(c.ground,0)+c.agl;},
 step(c,dt){c.age+=dt;const age=c.age,G=TV.U.uWind.value,wd=windDir(),ws=Math.hypot(G.x,G.z);c.wd=wd;
  c.shear+=((clamp(0.08+ws*0.09,0.08,0.7))-c.shear)*Math.min(1,dt*0.3);
  // steering flow: the cell drifts with the wind (a supercell veers a little to the right of it)
  const mv=0.6*ws*(c.mat>0.3?1:0.6);if(!c.anchored||!c.dis||!W.disasters.includes(c.dis)){c.x+=wd[0]*mv*dt+(c.type==='cb'&&c.spin>0?-wd[1]:wd[1])*0.05*mv*dt;c.z+=wd[1]*mv*dt;c.anchored=false;}
  // life stages
  c.mat=sstep(c.tGrow*0.5,c.tGrow*1.3,age);
  if(age>c.tDec)c.dec=clamp((age-c.tDec)/80,0,1);
  const dec=c.dec;
  // updraft: buoyancy accelerates the parcel, water loading and entrainment brake it, the stable stratosphere stops it
  const Hcap=c.ha*1.07;let w=(Hcap/(c.tGrow*0.62))*sstep(0,8,age)*(1-Math.pow(clamp((c.H-0.78*c.ha)/(0.3*c.ha),0,1),2))*(1-c.rain*0.35)*(1-dec);
  c.w+=(w-c.w)*Math.min(1,dt*1.2);
  c.H+=c.w*dt;if(dec>0)c.H=Math.max(c.H*(1-0.06*dt*dec),c.ha*0.45*(1-dec*0.5));
  c.H=Math.min(c.H,Hcap);
  c.rise=3+c.w*0.9;
  // anvil outflow: a gravity current that spreads once the top reaches the tropopause
  const top=sstep(0.72*c.ha,0.9*c.ha,c.H);
  if(top>0&&dec<1)c.Ra+=(c.RaMax-c.Ra)*Math.min(1,dt*top*0.034)+dt*4*top*(1-c.Ra/c.RaMax);
  if(dec>0.5)c.Ra+=dt*1.5;
  // precipitation starts once the top is glaciated (above the freezing level) and falls out as the updraft weakens
  const rt=c.i*(0.75+0.25*c.mat)*sstep(0.45*c.ha,0.72*c.ha,c.H)*(1-sstep(0.5,0.95,dec));
  c.rain+=(rt-c.rain)*Math.min(1,dt/14);
  c.tk=1-0.62*sstep(0,1,dec);c.wall=(c.dis&&(c.dis.type==='tornado'||c.dis.type==='supercell'))?clamp(c.mat*1.3-0.2,0,1)*(1-dec):0;
  // dissipation: the anvil lingers and thins, the tower rots away from the bottom
  c.fade=c.dec>0.8?1-sstep(0.8,1,c.dec)*0.97:1;if(age>c.life+60)c.fade=0;
  c.spin+=0;
  // lightning: more flashes in a strong, glaciated updraft
  if(c.flash>0)c.flash=Math.max(0,c.flash-dt*(c.flash>1.2?5:3.4));
  c.lightT-=dt;
  const rate=(0.08+1.5*c.rain*c.mat)*Math.min(1,c.w/3+0.3)*(1-dec);
  if(c.lightT<=0&&rate>0.01){c.lightT=(0.4+Math.random()*1.2)/rate;this.flash(c);}
 },
 flash(c){const a=Math.random()*6.283,rr=Math.random()*c.R0*0.6,h=c.ha*(0.25+Math.random()*0.55);
  c.fx=c.x+Math.cos(a)*rr;c.fz=c.z+Math.sin(a)*rr;c.fy=c.oy+h;c.flash=0.5+Math.random()*1.2;
  // cloud-to-ground strokes come out of the rain-cooled base
  if(Math.random()<0.45&&c.rain>0.15&&TV.FX3&&TV.FX3.bolt)TV.FX3.bolt(c.x+Math.cos(a)*c.R0*0.9,c.z+Math.sin(a)*c.R0*0.9,c.oy-4);},
 update(dt){const L=this.cells;for(let k=L.length-1;k>=0;k--){const c=L[k];
   if(c.dis&&c.anchored){if(W.disasters.includes(c.dis)){c.x+=(c.dis.x+0.5-c.x)*Math.min(1,dt*2);c.z+=(c.dis.y+0.5-c.z)*Math.min(1,dt*2);}else c.anchored=false;}
   this.step(c,dt);this.ground(c);
   if(c.age>c.life+70||(c.fade<=0.01&&c.age>c.life)){Vol.remove(c);L.splice(k,1);continue;}
   // far away from the player: keep it, but do not spend GPU on it
   const d=Math.hypot(c.x-FP.px,c.z-FP.pz);c.far=d>2600+c.RaMax;
   if(!c.far)Vol.sync(c);else c.mesh.visible=false;}}};
TV.Cb=Cb;

// ------------------------------------------------------------
//  VOLCANIC PLUME physics
// ------------------------------------------------------------
// Mass flux sets the height (H ~ flux^1/4); the column accelerates out of the vent as a dense gas-thrust jet, entrains
// air and rises buoyantly as a billowing cone, overshoots its neutral-buoyancy level and settles back, and
// spreads sideways there as an umbrella. When the vent stops feeding it the column detaches and the ash cloud drifts.
const Plume={list:[],
 make(d){const T2=d.type,k=T2==='volcano'?0:T2==='volcano_l'?1:2,i=clamp(d.i||0.6,0.2,1);
  const hb=[150,420,1100][k]*(0.75+0.5*i),R0=[9,20,48][k]*(0.8+0.5*i);
  const p={type:'plume',kind:k,x:d.x+0.5,z:d.y+0.5,oy:0,agl:0,ground:0,dis:d,i,ha:hb,R0,Ta:hb*[0.13,0.18,0.22][k],RaMax:hb*[0.55,0.95,1.2][k],Ra:0,H:2,age:0,feed:1,since:0,mat:0,fade:1,tk:1,wd:[1,0],shear:0.3,spin:0.6,rise:12,f0:1/(R0*9+hb*0.05),K:0.1,ls:hb*0.05,maxStep:Math.max(8,Math.min(14,hb*0.03)),alb:[0.64,0.57,0.52],flash:0,fx:0,fy:0,fz:0,
   rain:0,cut:0,glow:1,skirtR:0,skirtH:0,anchored:true,lightT:2,pulse:Math.random()*6.283,dtAll:0};
  p.tRise=[26,58,110][k];p.life=[240,420,700][k];p.wall=0;return p;},
 spawn(d){const p=this.make(d);this.list.push(p);Vol.add(p);this.ground(p);return p;},
 ground(p){p.ground=TV.terrH(clamp(p.x,1,W.n-2),clamp(p.z,1,W.n-2));p.oy=p.ground;},
 step(p,dt){const d=p.dis,alive=d&&W.disasters.includes(d);p.age+=dt;const age=p.age;
  const G=TV.U.uWind.value,ws=Math.hypot(G.x,G.z);p.wd=windDir();
  // pulses of the vent (vulcanian bursts) make the feed flicker around its mean
  const pr=alive?clamp(d.t/Math.max(1,d.dur),0,1):1;
  const feedT=alive?sstep(0,0.08,pr)*(0.85+0.15*Math.sin(age*0.9+p.pulse))*(1-sstep(0.82,1,pr)*0.6):0;
  p.feed+=(feedT-p.feed)*Math.min(1,dt*0.8);
  if(!alive)p.since+=dt;
  // a weak plume bends over in the wind, a strong one stands upright
  const bend=clamp(ws*0.1/(0.12+p.kind*0.14),0.1,0.9);p.shear+=((bend)-p.shear)*Math.min(1,dt*0.4);
  // rising front: the head accelerates away from the vent then decelerates against stratification
  const Hcap=p.ha*1.18*(0.5+0.5*clamp(p.feed+0.2,0,1)),vr=Hcap/(p.tRise*0.38);
  if(p.since<4)p.H+=vr*Math.pow(clamp(1-p.H/Hcap,0,1),0.8)*dt*(0.35+0.65*sstep(0,6,age))*clamp(p.feed*1.2+0.1,0,1);
  else p.H=Math.max(p.ha*0.98,p.H-dt*2);
  p.H=Math.min(p.H,Hcap);
  p.mat=sstep(p.tRise*0.2,p.tRise*0.9,age);
  p.rise=2+vr*0.55;
  // umbrella spreads as a gravity current once the head passes the neutral level
  const top=sstep(0.8*p.ha,1.02*p.ha,p.H);
  if(top>0)p.Ra+=(p.RaMax-p.Ra)*Math.min(1,dt*top*0.026)+dt*(p.RaMax*0.012)*top;
  // the lower column detaches when the feed stops
  p.cut=p.since>4?clamp((p.since-4)/60,0,1)*p.ha*1.05:0;
  p.tk=1-0.5*sstep(0.6,1,p.since/80);
  // ash fallout under the umbrella, heavier for the big eruptions
  p.rain+=((top*p.mat*(0.3+0.5*p.kind/2))*(p.since>0?1:0.8)-p.rain)*Math.min(1,dt/18);
  // pyroclastic skirt (column collapse): big eruptions throw a ground-hugging flow
  const coll=p.kind>=1&&alive?sstep(0.35,0.7,pr)*(p.kind===2?1:0.45):0;
  const skTarget=p.kind>=1?p.ha*(p.kind===2?0.62:0.22)*clamp(Math.max(coll,p.skirtR>1?1:0),0,1):0;
  if(coll>0)p.skirtR+=((skTarget)-p.skirtR)*Math.min(1,dt*0.05*coll)+dt*coll*(p.kind===2?3.5:1.2);
  p.skirtR=Math.min(p.skirtR,skTarget);p.skirtH=18+p.skirtR*0.06;
  p.glow=clamp(p.feed*1.1,0,1)*(1-sstep(0,25,p.since));
  // fade the whole thing out only at the very end of its life
  p.fade=clamp(1-sstep(p.life*0.72,p.life,age+(alive?0:p.since*0.7)),0,1);
  p.K=0.1;
  if(p.flash>0)p.flash=Math.max(0,p.flash-dt*3.4);
  p.lightT-=dt;if(p.lightT<=0&&p.feed>0.25&&p.H>p.ha*0.3){p.lightT=(0.5+Math.random()*1.6)/(0.4+p.kind*0.6);const a=Math.random()*6.283,rr=Math.random()*p.R0*1.5,h=p.H*(0.2+Math.random()*0.7);p.fx=p.x+Math.cos(a)*rr;p.fz=p.z+Math.sin(a)*rr;p.fy=p.oy+h;p.flash=0.6+Math.random()*1.4;}
 },
 update(dt){const L=this.list;
  // pick up new eruptions
  for(const d of W.disasters){if(!(d.type.startsWith('volcano')||d.type==='supervolcano'))continue;if(d._plume)continue;d._plume=true;if(Math.hypot(d.x-FP.px,d.y-FP.pz)<3200)this.spawn(d);}
  for(let k=L.length-1;k>=0;k--){const p=L[k];this.step(p,dt);this.ground(p);
   if(p.age>p.life+40||p.fade<=0.01&&p.age>p.life*0.6){Vol.remove(p);L.splice(k,1);continue;}
   const dd=Math.hypot(p.x-FP.px,p.z-FP.pz);if(dd<4500+p.RaMax)Vol.sync(p);else p.mesh.visible=false;}}};
TV.Plume=Plume;

// ------------------------------------------------------------
//  scanning the simulation and keeping the volumes in step with it
// ------------------------------------------------------------
const CBTYPES={supercell:1,anvil:1,tornado:1};
Cb.scan=function(){const w=W;
 for(const d of w.disasters){if(!CBTYPES[d.type]||d._cb)continue;d._cb=true;
  const dist=Math.hypot(d.x-FP.px,d.y-FP.pz);if(dist>3200)continue;
  const big=d.type==='supercell'?1:d.type==='anvil'?0.8:0.6;
  const c=this.spawn({x:d.x+0.5,z:d.y+0.5,dis:d,i:clamp((d.i||0.6)*big+0.15,0.25,1),r:d.r||8,seed:(d.data&&(d.data.cloudSeed||d.data.seed))||d.x*7+d.y});
  if(d.type==='tornado'){c.ha*=0.8;c.Ta=c.ha*0.13;c.RaMax*=0.55;}}
 // thunderstorm weather keeps a few mature cells standing around the player
 const wt=w.weather;const want=wt.type===4?Math.ceil(0.5+wt.inten*2.2):0;
 const amb=this.cells.filter(c=>c.kind==='ambient'&&c.dec<0.3);
 if(amb.length<want&&this._ambT<=0){this._ambT=6+Math.random()*10;
  const wd=windDir(),a=Math.atan2(-wd[1],-wd[0])+(Math.random()-0.5)*2.6,r=700+Math.random()*1300;
  const x=clamp(FP.px+Math.cos(a)*r,2,w.n-2),z=clamp(FP.pz+Math.sin(a)*r,2,w.n-2);
  this.spawn({x,z,kind:'ambient',i:0.55+Math.random()*0.4,r:6+Math.random()*8,seed:Math.random()*1e4});}
 // when the weather clears, the ambient cells are left to decay
 if(want<amb.length){for(const c of amb.slice(want)){if(c.age<c.tDec)c.tDec=c.age;}}
};
Cb._ambT=0;

{const _upd=TV.FX3.update;
 TV.FX3.update=function(dt,now){_upd.call(this,dt,now);
  if(!Vol.ready)return;
  const tv=TV,U=tv.U;
  // FX time already includes the simulation speed
  let fdt=dt>0?Math.min(2,dt*(Sim.speed||1)):0;Cb._ambT-=fdt;
  if(!tv.active)return;
  if(FP.interior){for(const o of Vol.list)o.mesh.visible=false;return;}
  Cb.scan();Cb.update(fdt);Plume.update(fdt);
  TV.Sky&&TV.Sky.afterVolumes&&TV.Sky.afterVolumes(fdt);
 };}
// make the volumes ready when the engine is built; new worlds start without any
{const _setup=TV.setup;TV.setup=function(){_setup.call(this);Vol.init(this);};
 const _reset=TV.FX3.reset;TV.FX3.reset=function(){_reset.call(this);Vol.clear();Cb.cells.length=0;Plume.list.length=0;for(const d of (W.disasters||[])){d._cb=false;d._plume=false;}};}

// the old particle structures for these storms and eruptions are replaced; flames, lava bombs and lights stay
{const _cb=TV.FX3.cbTick;TV.FX3.cbTick=function(d,dt){if(CBTYPES[d.type])return;return _cb.call(this,d,dt);};
 const _vol=TV.FX3.volcanoTick;TV.FX3.volcanoTick=function(d,dt){const x=d.x+0.5,z=d.y+0.5,y=FP.heightAt(x,z),T2=d.type,k=T2==='volcano'?1:T2==='volcano_l'?2:4;
  // lava fountain and bombs at the vent; the ash column itself is the volumetric plume
  if(Math.random()<dt*28*k){const a=Math.random()*6.283,sp=3+Math.random()*8*Math.sqrt(k);this.flame(x,y+0.2,z,{vx:Math.cos(a)*sp*0.5,vy:sp*1.4,vz:Math.sin(a)*sp*0.5,size:0.25+Math.random()*0.4,life:2.4+Math.random()*1.8,heat:1,cool:3,drag:0.05,grav:1});}
  if(Math.random()<dt*3*k)this.smokePuff(x+(Math.random()-0.5)*2,y+0.5,z+(Math.random()-0.5)*2,{size:1.2+k*0.6,grow:1.5,vy:6+k*3,vx:(Math.random()-0.5)*5,vz:(Math.random()-0.5)*5,drag:0.6,life:5,a:0.8,col:[0.2,0.18,0.17],lo:true});
  if(Math.random()<dt*2)this.light(x,y+2,z,800*k,0.5,[1,0.45,0.15]);};}
// lightning can start at a given height (cloud base) instead of the fixed cumulus layer
{const _bolt=TV.FX3.bolt;TV.FX3.bolt=function(x,z,y0){const T=this.tv.T;if(y0===undefined)return _bolt.call(this,x,z);
  const y1=FP.heightAt(x,z);const pts=[];let px=x+(Math.random()-0.5)*14,pz=z+(Math.random()-0.5)*14;const n=22;for(let k=0;k<=n;k++){const t=k/n;const j=(1-t)*5+0.3;pts.push(new T.Vector3(px+(x-px)*t+(Math.random()-0.5)*j,y0+(y1-y0)*t,pz+(z-pz)*t+(Math.random()-0.5)*j));}
  const g=new T.TubeGeometry(new T.CatmullRomCurve3(pts),70,0.2,5,false);const m=new T.Mesh(g,this.boltMat.clone());this.tv.groups.fx.add(m);this.bolts.push({m,t:0});this.light(x,y1+5,z,90000,0.15,[0.75,0.82,1]);this.flash=Math.max(this.flash,0.3);
  const d=Math.hypot(x-FP.px,z-FP.pz);this.events.push({t:d/TV_SOUND,fn:()=>Sound.play('thunder',Math.min(1,3/(1+d*0.05)))});};}
})();

// ============================================================
//  PART B: the sky itself
//   low layer  cumulus humilis -> mediocris -> congestus, driven by heating, humidity and time of day; stratocumulus
//              and overcast sheets for rain and snow; a domain warp so clouds swirl instead of sliding rigidly
//   mid layer  altocumulus cloudlets
//   high layer wind-combed cirrus filaments and a 22 degree halo through cirrostratus
//   shadows    storm and ash plumes shade the ground and dim the sun under them
// ============================================================
(function(){
if(typeof TV==='undefined')return;
const sstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};

TV.makeSky=function(){const T=this.T,U=this.U;
 const mat=new T.ShaderMaterial({side:T.BackSide,depthWrite:false,depthTest:false,uniforms:Object.assign({uSunColS:{value:new T.Color()},uCamPos:{value:new T.Vector3()},uFlash:{value:0},uMoon:{value:new T.Vector3()},uInstab:{value:0.3},uStrat:{value:0},uAlto:{value:0},uCirr:{value:0.25},uAltoY:{value:290}},U),
  vertexShader:`varying vec3 vD;void main(){vD=normalize(position);vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_Position.z=gl_Position.w*0.9999;}`,
  fragmentShader:`precision highp float;precision highp sampler3D;varying vec3 vD;uniform sampler3D uNoise3;uniform float uTime,uCover,uCloudDark,uCloudSteps,uCloudLo,uCloudHi,uFlash,uInstab,uStrat,uAlto,uCirr,uAltoY;uniform vec3 uCamPos,uSunCol,uMoon;uniform vec4 uStorm[6];uniform float uStormT[6];uniform vec3 uWind;
   ${this.skyGLSL}
   float h3(vec3 p){p=fract(p*0.3183+0.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
   float ss(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
   float cover(vec2 xz){float c=uCover;for(int i=0;i<6;i++){vec4 s=uStorm[i];if(s.w<=0.)continue;float d=length(xz-s.xy)/s.z;c=max(c,mix(c,1.0,s.w*(1.-ss(0.55,1.,d))));}return c;}
   // low layer density. Supercells, thunderheads and tornado parents are volumetric cells now; hurricanes still shape this layer.
   float dens(vec3 p,float cov,bool full){float h=(p.y-uCloudLo)/(uCloudHi-uCloudLo);if(h<0.||h>1.)return 0.;
    float band=0.,eye=0.;
    for(int i=0;i<6;i++){vec4 s=uStorm[i];float ty=uStormT[i];if(s.w<=0.||ty<0.5||ty>1.5)continue;
     vec2 rel=(p.xz-s.xy)/max(s.z,0.001);float r=length(rel);float th=atan(rel.y+1e-4,rel.x);float seed=s.x*0.37+s.y*0.73;
     float arms=0.5+0.5*sin(3.*th+seed+r*7.5-uTime*(0.6+0.8*s.w));
     band+=s.w*arms*(1.-ss(0.25,1.05,r))*ss(0.02,0.15,r);eye+=s.w*(1.-ss(0.03,0.15,r));}
    vec3 q=p*0.0026+uWind*uTime*0.0016;
    // a slow swirl of the sample point: clouds boil and shear instead of sliding rigidly
    vec2 wp=texture(uNoise3,q*0.55+vec3(0.31,0.17,uTime*0.0003)).rg-0.5;q+=vec3(wp.x,wp.y*0.4,wp.y)*0.06;
    float b=texture(uNoise3,q).r;
    // some tops tower (congestus), others stay flat (humilis); heating decides how many
    float tn=texture(uNoise3,q*0.42+vec3(0.5,0.2,0.1)).r;
    float top=0.42+0.3*cov+(1.-tn)*0.4*uInstab;
    float prof=ss(0.,0.1,h)*(1.-ss(top,1.,h));
    float d=b*prof-(1.-cov)*0.9;
    d+=band*0.55;if(d<=0.)return 0.;
    if(full){float det=texture(uNoise3,q*4.3+uWind*uTime*0.003).g;d-=det*0.22*(1.-d);float fine=texture(uNoise3,q*11.+vec3(0.,uTime*0.002,0.)).g;d-=fine*0.07*(1.-d);}
    d-=eye*1.4;return clamp(d*2.6,0.,1.);}
   void main(){vec3 d=normalize(vD);vec3 c=skyCol(d);
    // sun disc, moon and stars
    float s=max(dot(d,uSun),0.);c+=uSunCol*pow(s,2400.)*60.*smoothstep(-0.05,0.02,uSun.y)*step(0.,d.y+0.02);
    float m=max(dot(d,uMoon),0.);float md=smoothstep(0.99988,0.99996,m);float halo=pow(m,900.)*0.5+pow(m,90.)*0.08;
    c+=vec3(0.88,0.91,1.)*md*1.6*(1.-uDay)+vec3(0.5,0.6,0.9)*halo*(1.-uDay);
    if(uDay<0.6&&d.y>0.){float sa=uTime*0.006,ca=cos(sa);vec3 rd=vec3(ca*d.x+sa*d.z,d.y,-sa*d.x+ca*d.z);vec3 sp=floor(rd*300.);float st=h3(sp);float tw=0.6+0.4*sin(uTime*3.+st*40.);if(st>0.9965)c+=vec3(0.9,0.95,1.)*(st-0.9965)*300.*(0.6-uDay)*smoothstep(0.,0.3,d.y)*tw;}
    // ---- cirrus: ice filaments combed out along the wind and hooked by shear, plus a veil that makes the 22 degree halo
    if(d.y>0.03){vec2 cuv=d.xz/(d.y+0.25)*0.7+uWind.xz*uTime*0.004;vec2 wdir=normalize(uWind.xz+vec2(1e-3)),wperp=vec2(-wdir.y,wdir.x);
     float warp=texture(uNoise3,vec3(cuv*0.45,0.31)).g-0.5;
     vec2 fp=vec2(dot(cuv,wdir)*0.42,dot(cuv,wperp)*1.9+warp*0.5);
     float ci=texture(uNoise3,vec3(fp*0.35,0.72)).r,ci2=texture(uNoise3,vec3(fp*1.5+0.2,0.15)).g,ci3=texture(uNoise3,vec3(fp*4.1,0.4)).g;
     float cir=ss(0.66-uCirr*0.1,0.97,ci*0.62+ci2*0.38+ci3*0.1)*ss(0.03,0.25,d.y)*(1.-uCloudDark*0.8)*(0.08+0.32*uCirr);
     float csun=pow(max(dot(d,uSun),0.),5.);c+=(uHor*0.7+uSunCol*(0.4+csun*1.6))*cir;
     float ang=acos(clamp(dot(d,uSun),-1.,1.));float veil=ss(0.45,0.95,uCirr);
     c+=uSunCol*exp(-pow((ang-0.384)/0.034,2.))*veil*veil*0.2*smoothstep(0.,0.15,uSun.y)*(1.-uCloudDark)*vec3(1.,0.93,0.82);
     c+=uSunCol*exp(-pow((ang-0.384)/0.09,2.))*veil*veil*0.04*smoothstep(0.,0.15,uSun.y);}
    // ---- altocumulus cloudlets in a patchy sheet
    if(uAlto>0.01&&d.y>0.04){float t=(uAltoY-uCamPos.y)/d.y;if(t>0.){vec3 p=uCamPos+d*t;vec2 uv=p.xz*0.0016+uWind.xz*uTime*0.0011;
      float n=texture(uNoise3,vec3(uv,0.2)).r,cells=texture(uNoise3,vec3(uv*2.7+0.3,0.55)).g;
      float acov=ss(1.02-uAlto*0.6,1.14-uAlto*0.5,n+0.35*uAlto);float cl=acov*ss(0.28,0.72,cells);
      float shade=ss(0.35,0.95,cells);
      vec3 lit=uSunCol*(0.5*max(uSun.y,0.)+0.1)*(0.7+0.5*shade)+uZen*0.45;vec3 shd=(uHor*0.6+uZen*0.35)*0.85;
      vec3 ac=mix(shd,lit,shade)*(1.-uCloudDark*0.55);
      float fade=ss(0.04,0.2,d.y)*exp(-t*0.00011);c=mix(c,ac,clamp(cl*0.9,0.,1.)*fade);}}
    // ---- low layer: ray-marched cumulus
    if(d.y>0.002&&uCloudSteps>0.){float t0=max(0.,(uCloudLo-uCamPos.y)/d.y),t1=(uCloudHi-uCamPos.y)/d.y;if(uCamPos.y>uCloudHi){t0=1e9;}t1=min(t1,t0+4200.);
     if(t1>t0){float n=uCloudSteps;float dt=(t1-t0)/n;float tr=1.;vec3 acc=vec3(0.);float tt=t0+dt*h3(d*917.+fract(uTime));
      vec3 amb=mix(uZen*0.9+vec3(0.06),uHor,0.35)*(1.-uCloudDark*0.7);vec3 sunc=uSunCol*(1.-uCloudDark*0.85);float ph=0.5+0.95*pow(max(dot(d,uSun),0.),6.)+0.2*pow(max(-dot(d,uSun),0.),4.);
      float lthick=uCloudHi-uCloudLo;
      for(int i=0;i<64;i++){if(float(i)>=n||tr<0.03)break;vec3 p=uCamPos+d*tt;float cov=mix(cover(p.xz),max(cover(p.xz),0.97),uStrat);float de=dens(p,cov,true);
       if(de>0.){
        float ld=dens(p+uSun*lthick*0.1,cov,false)+dens(p+uSun*lthick*0.26,cov,false)+dens(p+uSun*lthick*0.6,cov,false)*1.5+dens(p+uSun*lthick*1.4,cov,false)*2.2;
        float lt=exp(-ld*1.25)*(1.-exp(-de*4.));float ms=exp(-ld*0.38)*0.35;float hh=(p.y-uCloudLo)/lthick;
        float ao=0.5+0.5*ss(0.,0.5,hh);
        vec3 col=amb*(0.42+0.58*hh)*ao+sunc*(lt*ph*1.6+ms*0.16);
        float rim=pow(lt,2.5)*pow(max(dot(d,uSun),0.),6.);col+=sunc*rim*2.2*(1.-uCloudDark*0.5);
        float duskF=clamp(1.-abs(uSun.y)*4.,0.,1.);col+=vec3(0.9,0.35,0.2)*lt*duskF*0.35*(0.4+0.6*hh);
        col-=vec3(0.06,0.05,0.04)*(1.-hh)*uCloudDark;
        // flat grey base under overcast
        col=mix(col,col*vec3(0.72,0.75,0.8),uStrat*(1.-hh)*0.6);
        float a=1.-exp(-de*dt*0.045);acc+=tr*a*col;tr*=1.-a;}
       tt+=dt;}
      float fade=exp(-max(0.,t0-900.)*0.00032);c=mix(c,acc/max(1.-tr,0.001),(1.-tr)*fade);}}
    c+=vec3(1.,0.97,0.9)*uFlash;gl_FragColor=vec4(c,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`});
 this.skyMat=mat;const sky=new T.Mesh(new T.SphereGeometry(16000,48,24),mat);sky.renderOrder=-100;sky.frustumCulled=false;this.sky=sky;this.scene.add(sky);};

// ---------- terrain: storm and ash-cloud shadows ----------
{const _mm=TV.makeMaterials;TV.makeMaterials=function(){_mm.call(this);const tm=this.terrainMat,ob=tm.onBeforeCompile;
  tm.onBeforeCompile=function(sh){ob.call(this,sh);const U=TV.U;U.uCbS||(U.uCbS={value:Array.from({length:6},()=>new TV.T.Vector4())});sh.uniforms.uCbS=U.uCbS;
   sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform vec4 uCbS[6];float cbShadow(vec3 p){float s=1.;for(int i=0;i<6;i++){vec4 c=uCbS[i];if(c.w<=0.)continue;float d=length(p.xz-c.xy)/c.z;s*=1.-c.w*(1.-smoothstep(0.3,1.,d));}return s;}')
    .replace('reflectedLight.directDiffuse*=cs;reflectedLight.directSpecular*=cs;','float cbs=cbShadow(vWp);reflectedLight.directDiffuse*=cs*cbs;reflectedLight.directSpecular*=cs*cbs;');};
  tm.customProgramCacheKey=()=>'terrainCb';};}

// ---------- the sky regime: what kind of clouds the weather, heat and humidity call for ----------
const Sky=TV.Sky={st:{instab:0.3,strat:0,alto:0.2,cirr:0.3,heat:0.3},shade:0,rainHere:0,_fogAdd:0,
 steps(q){return Math.min(64,Math.round(q*(1+this.st.instab*0.35)));},
 afterVolumes(dt){const w=W,U=TV.U,st=this.st,wt=w.weather,ty=wt.type,inten=wt.inten;const ci=clamp(FP.pz|0,0,w.n-1)*w.n+clamp(FP.px|0,0,w.n-1);
  const T0=w.temp[ci],moist=w.moist[ci],sunY=Math.max(0,U.uSun.value.y);
  // convective heating: warm air, moist ground, high sun; clouds build in the afternoon and die at dusk
  let heat=clamp((T0-6)/22,0,1)*(0.35+0.65*sunY)*(0.45+0.9*moist);st._heat=(st._heat===undefined?heat:st._heat+(heat-st._heat)*Math.min(1,dt*0.02));
  let inst=st._heat*0.9,strat=0,alto=0.18+0.25*moist,cirr=0.15+0.12*moist;
  switch(ty){case 1:strat=0.3;alto=0.55;cirr=0.55;inst*=0.6;break;case 2:strat=0.78*inten+0.2;alto=0.7;cirr=0.8;inst=0.25;break;case 3:strat=0.94;alto=0.5;cirr=0.8;inst=0.3;break;
   case 4:strat=0.25;inst=1;alto=0.3;cirr=0.7;break;case 5:strat=0.8;alto=0.6;cirr=0.7;inst=0.1;break;case 6:strat=1;alto=0.2;cirr=0.5;inst=0.05;break;case 7:strat=0.55;alto=0;cirr=0.1;inst=0;break;
   case 8:inst=Math.max(inst,0.55);alto=0.05;cirr=0.15;break;case 9:inst*=0.4;alto=0.04;cirr=0.12;break;case 10:strat=0.2;alto=0.1;cirr=0.1;break;case 11:strat=0.9;inst=0.7;alto=0.4;cirr=0.9;break;}
  const k=Math.min(1,dt*0.12);st.instab+=(clamp(inst,0,1)-st.instab)*k;st.strat+=(clamp(strat,0,1)-st.strat)*k;st.alto+=(clamp(alto,0,1)-st.alto)*k*0.6;st.cirr+=(clamp(cirr,0,1)-st.cirr)*k*0.5;
  const sm=TV.skyMat.uniforms;sm.uInstab.value=st.instab;sm.uStrat.value=st.strat;sm.uAlto.value=st.alto;sm.uCirr.value=st.cirr;
  // thicker layer where convection is strong: congestus tops reach 2 km
  const dark=U.uCloudDark.value;U.uCloudHi.value=U.uCloudLo.value+61+dark*26+st.instab*150;
  // ---- storms and ash clouds shade the ground
  const sun=U.uSun.value,S=U.uCbS||(U.uCbS={value:Array.from({length:6},()=>new TV.T.Vector4())});let si=0;const cam=TV.cam.position;let under=0,rainHere=0;
  const vols=TV.Vol.list.filter(o=>o.mesh.visible).sort((a,b)=>Math.hypot(a.x-cam.x,a.z-cam.z)-Math.hypot(b.x-cam.x,b.z-cam.z));
  const sdx=-sun.x/Math.max(sun.y,0.12),sdz=-sun.z/Math.max(sun.y,0.12);
  for(const o of vols){if(si>=5)break;const plume=o.type==='plume',wd=o.wd;
   // the anvil or umbrella is a high plate: its shadow lands far from it when the sun is low
   if(o.Ra>12){const Hh=o.oy+o.ha,lean=o.shear*o.ha+(plume?0.2:0.3)*o.Ra,cx=o.x+wd[0]*lean+sdx*Hh,cz=o.z+wd[1]*lean+sdz*Hh;const r=o.Ra*(plume?0.85:0.62),str=(plume?0.85:0.6)*o.fade*sstep(0,1,o.Ra/o.RaMax);
    S.value[si].set(cx,cz,r,str);si++;if(Math.hypot(cam.x-cx,cam.z-cz)<r)under=Math.max(under,str*(1-Math.hypot(cam.x-cx,cam.z-cz)/r*0.6));}
   // the tower, rain shaft and column shade a smaller patch and, standing in it, make real dusk
   const Ht=o.oy+Math.min(o.H,o.ha)*0.5,tx=o.x+sdx*Ht+wd[0]*o.shear*o.ha*0.1,tz=o.z+sdz*Ht+wd[1]*o.shear*o.ha*0.1,tr=o.R0*(plume?2.2:1.6),ts=(plume?0.75:0.7)*o.fade*sstep(0,1,Math.min(1,o.H/(o.ha*0.5)));
   if(si<6&&ts>0.02){S.value[si].set(tx,tz,tr,ts);si++;if(Math.hypot(cam.x-tx,cam.z-tz)<tr)under=Math.max(under,ts*(1-Math.hypot(cam.x-tx,cam.z-tz)/tr*0.5));}
   // rain: standing inside the shaft under a precipitating cell
   if(!plume&&o.rain>0.05){const sx=o.x+(Math.cos(0.55)*o.wd[0]-Math.sin(0.55)*o.wd[1])*o.R0*0.8,sz=o.z+(Math.sin(0.55)*o.wd[0]+Math.cos(0.55)*o.wd[1])*o.R0*0.8,dd=Math.hypot(cam.x-sx,cam.z-sz);if(dd<o.R0*0.85)rainHere=Math.max(rainHere,o.rain*(1-dd/(o.R0*0.85)*0.5)*(cam.y<o.oy?1:0));}
   if(plume&&o.rain>0.05){const dd=Math.hypot(cam.x-(o.x+wd[0]*(o.shear*o.ha+0.35*o.Ra)),cam.z-(o.z+wd[1]*(o.shear*o.ha+0.35*o.Ra)));if(dd<o.Ra*0.7)rainHere=Math.max(rainHere,o.rain*0.8*(1-dd/(o.Ra*0.7)));}}
  for(;si<6;si++)S.value[si].set(0,0,1,0);
  let fogAdd=0;this.shade+=(under-this.shade)*Math.min(1,dt*0.8);this.rainHere+=(rainHere-this.rainHere)*Math.min(1,dt*0.5);
  const sh=this.shade;if(sh>0.01){TV.sun.intensity*=1-0.82*sh;TV.hemi.intensity*=1-0.3*sh;U.uCloudDark.value=Math.min(1,U.uCloudDark.value+sh*0.5);fogAdd+=0.0016*sh;}
  if(this.rainHere>0.02){const rm=TV.FX3.rainMat.uniforms;rm.uAmt.value=Math.max(rm.uAmt.value,Math.min(0.95,this.rainHere));TV.FX3.rain.visible=!FP.interior;fogAdd+=0.003*this.rainHere;}
  TV.scene.fog.density+=fogAdd;this._fogAdd=fogAdd;
 }};
// the extra storm haze is taken off again before the engine eases the fog toward its own target
{const _r=TV.render;TV.render=function(t,now){const f=this.scene&&this.scene.fog;if(f&&Sky._fogAdd){f.density-=Sky._fogAdd;Sky._fogAdd=0;}return _r.call(this,t,now);};}
})();
