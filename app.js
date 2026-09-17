const errBox = document.getElementById('err');
function fail(m){ errBox.style.display='block'; errBox.textContent=m; console.error(m); }

const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', {antialias:false, alpha:false, preserveDrawingBuffer:true});
if(!gl){ fail('WebGL2 нет'); throw 0; }

function compile(type, src){
  const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(vs,fs){
  const p=gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
let prog;
try{ prog=program(VS,FS); }catch(e){ fail('shader: '+e.message); throw e; }
gl.useProgram(prog);
const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buf);
gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
const loc=gl.getAttribLocation(prog,'a');
gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);

const U={};
for(const n of ['uR','uT','uBass','uMid','uHigh','uFlux','uGen','uIn','uClap','uAmt','uMirr','uDbl','uFeed','uPrism','uGhost','uPrev']){
  U[n]=gl.getUniformLocation(prog,n);
}

function makeTex(){
  const t=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,8,8,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  return t;
}
const prevTex=makeTex();

const st={
  fx:{mirror:0,double:0,feed:0,prism:0,ghost:0},
  amt:0.55,
  inside:0, targetInside:0, clap:0,
  gen:0, phrase:0,
  bass:0, mid:0, high:0, flux:0, level:0,
  armed:false
};

const audio={ctx:null, analyser:null, src:null, stream:null, spec:null, prev:null, lastBeat:0, beats:0};

async function listDev(){
  try{
    const list=await navigator.mediaDevices.enumerateDevices();
    const ins=list.filter(d=>d.kind==='audioinput');
    const sel=document.getElementById('dev');
    const cur=sel.value;
    sel.innerHTML='<option value="">— выбрать устройство —</option>';
    for(const d of ins){
      const o=document.createElement('option');
      o.value=d.deviceId;
      o.textContent=d.label || 'вход '+d.deviceId.slice(0,6);
      sel.appendChild(o);
    }
    if(cur) sel.value=cur;
  }catch(e){ fail('устройства: '+e.message); }
}

async function arm(){
  try{
    if(!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia нет (нужен https или localhost)');
    const id=document.getElementById('dev').value;
    if(audio.stream){ audio.stream.getTracks().forEach(t=>t.stop()); }
    const cons={ audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false } };
    if(id) cons.audio.deviceId={exact:id};
    const stream=await navigator.mediaDevices.getUserMedia(cons);
    audio.stream=stream;
    if(!audio.ctx) audio.ctx=new (window.AudioContext||window.webkitAudioContext)();
    if(audio.ctx.state==='suspended') await audio.ctx.resume();
    if(audio.src) try{ audio.src.disconnect(); }catch(_){}
    audio.src=audio.ctx.createMediaStreamSource(stream);
    audio.analyser=audio.ctx.createAnalyser();
    audio.analyser.fftSize=2048;
    audio.analyser.smoothingTimeConstant=0.65;
    audio.spec=new Uint8Array(audio.analyser.frequencyBinCount);
    audio.prev=new Float32Array(audio.analyser.frequencyBinCount);
    audio.src.connect(audio.analyser);
    st.armed=true;
    document.getElementById('arm').classList.add('live');
    await listDev();
  }catch(e){ fail('line-in: '+e.message); }
}

function sampleAudio(){
  if(!audio.analyser){ st.level*=0.96; return; }
  audio.analyser.getByteFrequencyData(audio.spec);
  const n=audio.spec.length;
  let b=0,m=0,h=0,flux=0;
  const nB=Math.floor(n*0.06), nM=Math.floor(n*0.28);
  for(let i=1;i<n;i++){
    const v=audio.spec[i]/255;
    const pv=audio.prev[i];
    const d=v-pv; if(d>0) flux+=d;
    audio.prev[i]=v;
    if(i<nB) b+=v; else if(i<nM) m+=v; else h+=v;
  }
  b/=Math.max(nB,1); m/=Math.max(nM-nB,1); h/=Math.max(n-nM,1);
  flux/=n;
  st.bass=st.bass*0.7+b*0.3;
  st.mid=st.mid*0.75+m*0.25;
  st.high=st.high*0.8+h*0.2;
  st.flux=st.flux*0.5+flux*0.5;
  st.level=Math.min(1, st.bass*1.4+st.mid*0.5);
  const now=performance.now();
  const thr=0.018+st.flux*0.15;
  if(st.flux>thr && now-audio.lastBeat>240){
    audio.lastBeat=now;
    audio.beats++;
    document.getElementById('lamp').classList.add('hot');
    setTimeout(()=>document.getElementById('lamp').classList.remove('hot'),90);
    if(audio.beats%8===0){
      st.gen=Math.min(12, st.gen+1);
      st.phrase++;
      st.targetInside = st.targetInside>0.5 ? 0 : 1;
      st.clap=1;
    }
  }
}

function clapNow(){
  st.targetInside = st.targetInside>0.5 ? 0 : 1;
  st.clap=1;
}

let rec=null, recChunks=[];
function toggleRec(){
  if(rec && rec.state==='recording'){ rec.stop(); return; }
  const stream=canvas.captureStream(30);
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' :
               MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '';
  recChunks=[];
  rec=new MediaRecorder(stream, mime?{mimeType:mime, videoBitsPerSecond:6000000}:{});
  rec.ondataavailable=e=>{ if(e.data.size) recChunks.push(e.data); };
  rec.onstop=()=>{
    const blob=new Blob(recChunks,{type:rec.mimeType||'video/webm'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='organism-'+Date.now()+'.webm';
    a.click();
    document.getElementById('rec').classList.remove('rec');
    document.getElementById('rec').textContent='REC';
  };
  rec.start(500);
  document.getElementById('rec').classList.add('rec');
  document.getElementById('rec').textContent='STOP';
}

document.getElementById('arm').onclick=arm;
document.getElementById('clap').onclick=clapNow;
document.getElementById('rec').onclick=toggleRec;
document.getElementById('amt').oninput=e=>{ st.amt=+e.target.value; };
document.getElementById('pads').onclick=e=>{
  const b=e.target.closest('button[data-fx]'); if(!b) return;
  const k=b.dataset.fx; st.fx[k]=st.fx[k]?0:1; b.classList.toggle('on', !!st.fx[k]);
};
document.addEventListener('keydown',e=>{
  if(e.repeat) return;
  const k=e.key.toLowerCase();
  if(k===' '){ e.preventDefault(); clapNow(); }
  if(k==='h') document.body.classList.toggle('clean');
  if(k==='r') toggleRec();
  if(k==='l') arm();
  const map={1:'mirror',2:'double',3:'feed',4:'prism',5:'ghost'};
  if(map[k]){
    st.fx[map[k]]^=1;
    const b=document.querySelector('[data-fx="'+map[k]+'"]');
    if(b) b.classList.toggle('on', !!st.fx[map[k]]);
  }
});

navigator.mediaDevices?.addEventListener?.('devicechange', listDev);
listDev();

function fit(){
  const dpr=Math.min(devicePixelRatio||1, 1.75);
  const w=Math.max(2, Math.floor(innerWidth*dpr));
  const h=Math.max(2, Math.floor(innerHeight*dpr));
  if(canvas.width!==w || canvas.height!==h){
    canvas.width=w; canvas.height=h;
    gl.viewport(0,0,w,h);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  }
}

let t0=performance.now();
function frame(now){
  requestAnimationFrame(frame);
  fit();
  sampleAudio();
  const dt=Math.min(0.05,(now-t0)/1000); t0=now;
  st.inside += (st.targetInside-st.inside)*Math.min(1, dt*(st.clap>0.4?8:2.2));
  st.clap=Math.max(0, st.clap-dt*2.4);
  gl.useProgram(prog);
  gl.bindTexture(gl.TEXTURE_2D, prevTex);
  gl.uniform1i(U.uPrev,0);
  gl.uniform2f(U.uR, canvas.width, canvas.height);
  gl.uniform1f(U.uT, now*0.001);
  gl.uniform1f(U.uBass, st.bass);
  gl.uniform1f(U.uMid, st.mid);
  gl.uniform1f(U.uHigh, st.high);
  gl.uniform1f(U.uFlux, st.flux);
  gl.uniform1f(U.uGen, st.gen);
  gl.uniform1f(U.uIn, st.inside);
  gl.uniform1f(U.uClap, st.clap);
  gl.uniform1f(U.uAmt, st.amt);
  gl.uniform1f(U.uMirr, st.fx.mirror);
  gl.uniform1f(U.uDbl, st.fx.double);
  gl.uniform1f(U.uFeed, st.fx.feed);
  gl.uniform1f(U.uPrism, st.fx.prism);
  gl.uniform1f(U.uGhost, st.fx.ghost);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  gl.bindTexture(gl.TEXTURE_2D, prevTex);
  gl.copyTexImage2D(gl.TEXTURE_2D,0,gl.RGBA,0,0,canvas.width,canvas.height,0);
  document.getElementById('mfill').style.width=(st.level*100)+'%';
  const side=st.inside>0.5?'INNER':'VOID';
  const grid=st.armed?(audio.beats?('фраза '+st.phrase+' · beat '+audio.beats):'ждёт удар'):'нет сетки';
  document.getElementById('sinfo').textContent=side+' · GEN '+st.gen.toFixed(0)+' · '+grid;
}
requestAnimationFrame(frame);
