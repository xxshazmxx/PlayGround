// Procedural WebAudio SFX — no assets, works on mobile after first tap.
let ctx = null, muted = false;
export function setMuted(m){ muted = m; }
export function isMuted(){ return muted; }
function ac(){
  if(!ctx){ ctx = new (window.AudioContext||window.webkitAudioContext)(); }
  if(ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function env(g, t0, a, peak, d){
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(peak,0.0002), t0+a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0+a+d);
}
export function sfx(kind){
  if(muted) return;
  try{
    const c = ac(), t = c.currentTime;
    if(kind==='hit' || kind==='chop'){
      const o=c.createOscillator(), g=c.createGain();
      o.type='triangle'; o.frequency.setValueAtTime(kind==='chop'?180:140, t);
      o.frequency.exponentialRampToValueAtTime(60, t+0.12);
      env(g,t,0.005,0.5,0.12); o.connect(g).connect(c.destination); o.start(t); o.stop(t+0.2);
      const n=c.createBufferSource(); const b=c.createBuffer(1,2205,44100);
      const d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*(1-i/d.length);
      n.buffer=b; const ng=c.createGain(); env(ng,t,0.002,0.25,0.08);
      const f=c.createBiquadFilter(); f.type='lowpass'; f.frequency.value=1200;
      n.connect(f).connect(ng).connect(c.destination); n.start(t);
    } else if(kind==='rock'){
      const o=c.createOscillator(), g=c.createGain();
      o.type='square'; o.frequency.setValueAtTime(900+Math.random()*400,t);
      o.frequency.exponentialRampToValueAtTime(300,t+0.06);
      env(g,t,0.002,0.12,0.07); o.connect(g).connect(c.destination); o.start(t); o.stop(t+0.12);
    } else if(kind==='shot'){
      const n=c.createBufferSource(); const b=c.createBuffer(1,8820,44100);
      const d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2);
      n.buffer=b; const g=c.createGain(); env(g,t,0.002,0.9,0.25);
      const f=c.createBiquadFilter(); f.type='lowpass'; f.frequency.setValueAtTime(4000,t);
      f.frequency.exponentialRampToValueAtTime(300,t+0.25);
      n.connect(f).connect(g).connect(c.destination); n.start(t);
    } else if(kind==='hurt'){
      const o=c.createOscillator(), g=c.createGain();
      o.type='sawtooth'; o.frequency.setValueAtTime(220,t);
      o.frequency.exponentialRampToValueAtTime(90,t+0.25);
      env(g,t,0.005,0.4,0.25); o.connect(g).connect(c.destination); o.start(t); o.stop(t+0.3);
    } else if(kind==='pickup' || kind==='craft'){
      const o=c.createOscillator(), g=c.createGain();
      o.type='sine'; o.frequency.setValueAtTime(kind==='craft'?520:660,t);
      o.frequency.exponentialRampToValueAtTime(kind==='craft'?880:990,t+0.12);
      env(g,t,0.005,0.3,0.15); o.connect(g).connect(c.destination); o.start(t); o.stop(t+0.25);
    } else if(kind==='eat'){
      const o=c.createOscillator(), g=c.createGain();
      o.type='sine'; o.frequency.setValueAtTime(300,t);
      for(let i=0;i<3;i++){ o.frequency.setValueAtTime(300+Math.random()*100, t+i*0.09); }
      env(g,t,0.005,0.35,0.3); o.connect(g).connect(c.destination); o.start(t); o.stop(t+0.35);
    } else if(kind==='build'){
      const o=c.createOscillator(), g=c.createGain();
      o.type='triangle'; o.frequency.setValueAtTime(150,t);
      o.frequency.exponentialRampToValueAtTime(400,t+0.15);
      env(g,t,0.005,0.4,0.2); o.connect(g).connect(c.destination); o.start(t); o.stop(t+0.3);
    }
  }catch(e){ /* audio unavailable */ }
}
