const programOnly = /(?:\?|&)program=1(?:&|$)/.test(location.search);
if (programOnly) document.body.classList.add('clean');

const VS = `#version 300 es
in vec2 a; void main(){ gl_Position = vec4(a,0.,1.); }`;

const FS = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uR;
uniform float uT,uBass,uMid,uHigh,uFlux,uGen,uIn,uClap,uAmt;
uniform float uMirr,uDbl,uFeed,uPrism,uGhost;
uniform sampler2D uPrev;

float hash(vec3 p){ p=fract(p*0.3183099+vec3(.1,.2,.3)); p+=dot(p,p.yzx+19.19); return fract(p.x*p.y*p.z); }
float n3(vec3 p){
  vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  float n=mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),
                  mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
              mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                  mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
  return n*2.-1.;
}
float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*n3(p); p=p*2.03+vec3(1.7,3.1,2.3); a*=.5; } return s; }

float hexPrism(vec3 p, float r, float h){
  const vec3 k=vec3(-0.8660254,0.5,0.57735);
  p=abs(p); p.xy-=2.*min(dot(k.xy,p.xy),0.)*k.xy;
  vec2 d=vec2(length(p.xy-vec2(clamp(p.x,-k.z*r,k.z*r),r))*sign(p.y-r), abs(p.z)-h);
  return min(max(d.x,d.y),0.)+length(max(d,0.));
}

float planeCut(vec3 p, vec3 n, float w){
  return dot(abs(p), normalize(n)) - w;
}

float crystal(vec3 p){
  float g=clamp(uGen,0.,12.);
  float s=planeCut(p, vec3(1,1,1), 1.02);
  s=max(s, planeCut(p, vec3(1,1,0), 0.96));
  s=max(s, planeCut(p, vec3(1,0,1), 0.96));
  s=max(s, planeCut(p, vec3(0,1,1), 0.96));
  s=max(s, planeCut(p, vec3(1,.35,.18), 0.88));
  s=max(s, planeCut(p, vec3(.22,1,.4), 0.90));
  s=max(s, length(p)-1.22);
  s=max(s, planeCut(p, vec3(.7,.2,1), 0.93+0.02*sin(g*0.7)));
  float hole=hexPrism(p - vec3(0.,0.,0.15), 0.28, 1.35);
  s=max(s, -hole);
  return s;
}

float shell(vec3 p){
  float o=crystal(p);
  float inn=crystal(p*1.12)+0.07;
  return max(o, -inn);
}

float veins(vec3 p){
  float g=uGen;
  float v=abs(fbm(p*3.1 + vec3(0., g*0.27, 0.03)));
  float w=abs(fbm(p.zxy*4.4 + 2.7));
  float ridge=min(v, w);
  float line=smoothstep(0.09, 0.015, ridge);
  float skin=1.0-smoothstep(0.0, 0.12, abs(crystal(p)));
  float grow=0.45+0.55*clamp(g/6.,0.,1.);
  return line*skin*grow;
}

vec2 map(vec3 p){
  float d=shell(p);
  float v=veins(p);
  return vec2(d,v);
}

vec3 nrm(vec3 p){
  vec2 e=vec2(.002,0.);
  return normalize(vec3(
    map(p+e.xyy).x-map(p-e.xyy).x,
    map(p+e.yxy).x-map(p-e.yxy).x,
    map(p+e.yyx).x-map(p-e.yyx).x
  ));
}

vec3 INK(){ return vec3(0.23,0.48,1.0); }
vec3 BLK(){ return vec3(0.02,0.025,0.04); }

void camPath(float k, out vec3 ro, out vec3 ta){
  float a=uT*0.12;
  vec3 outP=vec3(cos(a)*3.15, 0.55+0.18*sin(uT*0.21), sin(a)*3.15);
  vec3 hole=vec3(0.,0.,1.35);
  vec3 inn=vec3(0.08*sin(uT*0.17), 0.04*cos(uT*0.13), 0.12*sin(uT*0.09));
  vec3 innTa=vec3(0.2*sin(uT*0.07),0.15, -0.4);
  float s=smoothstep(0.,1.,k);
  float plunge=smoothstep(0.,0.55,s);
  float seat=smoothstep(0.45,1.,s);
  ro=mix(outP, hole, plunge);
  ro=mix(ro, inn, seat);
  ta=mix(vec3(0.), hole*0.2, plunge);
  ta=mix(ta, innTa, seat);
}

void main(){
  vec2 uv=(gl_FragCoord.xy-.5*uR)/min(uR.x,uR.y);
  vec2 suv=gl_FragCoord.xy/uR;
  if(uMirr>.5){
    uv.x=abs(uv.x);
    suv.x=abs(suv.x-.5)+.5;
  }
  vec3 ro,ta; camPath(clamp(uIn,0.,1.), ro, ta);
  vec3 ww=normalize(ta-ro);
  vec3 uu=normalize(cross(vec3(0.,1.,0.),ww));
  vec3 vv=cross(ww,uu);
  vec3 rd=normalize(uu*uv.x+vv*uv.y+ww*1.25);

  float t=0.; float hit=0.; float veinA=0.;
  vec3 p=ro;
  for(int i=0;i<64;i++){
    p=ro+rd*t;
    vec2 m=map(p);
    if(m.x<0.0015){ hit=1.; veinA=m.y; break; }
    t+=clamp(m.x,0.008,0.25);
    if(t>12.) break;
  }

  vec3 col=BLK();
  col+=INK()*exp(-length(uv)*2.2)*0.08*uMid;

  if(hit>0.5){
    vec3 n=nrm(p);
    vec3 l1=normalize(vec3(.35,.85,.25));
    float diff=max(dot(n,l1),0.);
    float rim=pow(1.-max(dot(n,-rd),0.),2.6);
    float spec=pow(max(dot(reflect(-l1,n),-rd),0.),34.);
    float depth=clamp(t/6.,0.,1.);
    vec3 base=mix(BLK(), vec3(0.07,0.08,0.10), diff);
    float pulse=0.45+0.55*uBass;
    col=base;
    col+=INK()*veinA*2.4*pulse;
    col+=INK()*rim*(0.22+0.40*uHigh);
    col+=INK()*spec*0.55;
    col+=INK()*pow(uFlux,1.4)*0.16;
    col=mix(col, BLK()*0.6, depth*0.5);
    if(uIn>0.55){
      float vault=pow(max(dot(n,vec3(0,1,0)),0.),2.);
      col+=INK()*vault*0.16;
    }
  }

  col+=INK()*uClap*0.35;
  col=max(col,vec3(0.));
  col=col/(1.+col*0.28);
  col=pow(col,vec3(0.95));

  vec3 prev=texture(uPrev, suv).rgb;
  if(uPrism>.5){
    float k=0.005+0.014*uAmt;
    float a=dot(texture(uPrev, clamp(suv+vec2(k,0.),0.,1.)).rgb, vec3(0.3,0.3,0.4));
    float b=dot(texture(uPrev, clamp(suv-vec2(k,0.),0.,1.)).rgb, vec3(0.3,0.3,0.4));
    col+=INK()*(a-b)*1.2;
  }
  if(uDbl>.5) col=min(col+prev*0.55*uAmt, vec3(1.4));
  if(uFeed>.5){
    vec2 fuv=(suv-.5)*(1.-0.02*uAmt)+.5;
    col=mix(col, texture(uPrev, clamp(fuv,0.,1.)).rgb, 0.42+0.28*uAmt);
  }
  if(uGhost>.5) col=mix(col, prev, 0.55+0.25*uAmt);

  o=vec4(clamp(col,0.,1.5),1.);
}
`;
