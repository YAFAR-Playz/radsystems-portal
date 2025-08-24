// js/login.fx.js
import { state } from './core/state.js';

export function initLoginFx(){
  // Parallax tilt
  document.querySelectorAll('[data-tilt]').forEach(el=>{
    let rAF; const damp = (v,f)=>v + (f - v)*0.08;
    let rx=0, ry=0, tx=0, ty=0;
    const onMove = e=>{
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left)/rect.width - 0.5;
      const y = (e.clientY - rect.top)/rect.height - 0.5;
      tx = -y*6; ty = x*6;
      if (!rAF) rAF = requestAnimationFrame(loop);
    };
    const onLeave = ()=>{ tx=0; ty=0; if (!rAF) rAF = requestAnimationFrame(loop); };
    const loop = ()=>{
      rx = damp(rx, tx); ry = damp(ry, ty);
      el.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) translateY(-2px)`;
      if (Math.abs(rx-tx)<.01 && Math.abs(ry-ty)<.01){ rAF=null; return; }
      rAF = requestAnimationFrame(loop);
    };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
  });

  // Background soft particles
  const c = document.getElementById('loginBgFx');
  if (c){
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ctx = c.getContext('2d');
    const P = Array.from({length: 38}, ()=>({
      x: Math.random(), y: Math.random(),
      r: .004 + Math.random()*.012, z: .3 + Math.random()*.7,
      vx: (Math.random()-.5)*.0005, vy:(Math.random()-.5)*.0005
    }));
    const resize = ()=>{
      c.width  = innerWidth * dpr; c.height = (document.documentElement.clientHeight) * dpr;
      ctx.setTransform(dpr,0,0,dpr,0,0);
    };
    addEventListener('resize', resize); resize();
    const tintA = getComputedStyle(document.documentElement).getPropertyValue('--brand-blue').trim() || '#1F3C88';
    const tintB = getComputedStyle(document.documentElement).getPropertyValue('--brand-green').trim() || '#6BCB77';

    function loop(){
      ctx.clearRect(0,0,c.width,dpr?c.height/dpr:c.height);
      P.forEach(p=>{
        p.x += p.vx; p.y += p.vy;
        if (p.x<0||p.x>1) p.vx*=-1; if (p.y<0||p.y>1) p.vy*=-1;
        const gx = p.x * innerWidth, gy = p.y * (document.documentElement.clientHeight);
        const r = (p.r * Math.min(innerWidth, innerHeight)) * 1.8;
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
        g.addColorStop(0, hexToRgba(p.z<.6?tintA:tintB, 0.18*p.z));
        g.addColorStop(1, hexToRgba('#000000', 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(gx, gy, r, 0, Math.PI*2); ctx.fill();
      });
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  // Optional brand 3D model (GLB/GLTF)
  try{
    const modelUrl = state?.branding?.assets?.loginModelUrl;
    if (modelUrl){
      await import('https://cdn.jsdelivr.net/npm/@google/model-viewer@3.4.0/dist/model-viewer.min.js');
      const mv = document.getElementById('loginModel');
      if (mv){ mv.src = modelUrl; mv.classList.remove('hidden'); }
    }
  }catch(_){}
}

function hexToRgba(hex, a){
  const h = hex.replace('#',''); const b = parseInt(h.length===3 ? h.split('').map(x=>x+x).join('') : h, 16);
  const r=(b>>16)&255, g=(b>>8)&255, bl=b&255; return `rgba(${r},${g},${bl},${a})`;
}
