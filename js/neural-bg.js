// 🧠 Red neuronal sutil de fondo — partículas conectadas
// Sin dependencias, ~3KB, pausada cuando la pestaña no está visible
(() => {
  const canvas = document.createElement('canvas');
  canvas.id = 'neural-bg';
  document.body.insertBefore(canvas, document.body.firstChild);
  const ctx = canvas.getContext('2d', { alpha: true });

  const CONFIG = {
    particleCount: 38,        // discreto, no satura
    maxDistance: 140,         // distancia para conectar dos partículas
    speed: 0.18,              // muy lento
    radius: 1.8,              // tamaño de cada nodo
    colorCyan: 'rgba(26, 200, 219, ',
    colorPurple: 'rgba(122, 60, 255, ',
  };

  let particles = [], W = 0, H = 0, raf = null, paused = false;

  function resize(){
    W = canvas.width = window.innerWidth * devicePixelRatio;
    H = canvas.height = window.innerHeight * devicePixelRatio;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.scale(devicePixelRatio, devicePixelRatio);
  }

  function init(){
    particles = [];
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = 0; i < CONFIG.particleCount; i++){
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * CONFIG.speed,
        vy: (Math.random() - 0.5) * CONFIG.speed,
        // Mezclar 60% cyan, 40% morado
        color: Math.random() < 0.6 ? CONFIG.colorCyan : CONFIG.colorPurple,
      });
    }
  }

  function tick(){
    if (paused){ raf = null; return; }
    const w = window.innerWidth, h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    // Mover y dibujar partículas
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      // Rebotar en bordes
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, CONFIG.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color + '0.55)';
      ctx.fill();
    });

    // Dibujar líneas entre partículas cercanas
    for (let i = 0; i < particles.length; i++){
      for (let j = i + 1; j < particles.length; j++){
        const a = particles[i], b = particles[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d < CONFIG.maxDistance){
          const alpha = (1 - d / CONFIG.maxDistance) * 0.32;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = a.color + alpha + ')';
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }
    }

    raf = requestAnimationFrame(tick);
  }

  function start(){ if (!raf) tick(); }

  // Pausar cuando la pestaña no está visible (ahorrar CPU)
  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    if (!paused) start();
  });

  window.addEventListener('resize', () => { resize(); init(); });

  resize();
  init();
  start();
})();
