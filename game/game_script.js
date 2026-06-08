"use strict";
(() => {
  /* =====================================================================
     CONFIG
     ===================================================================== */
  const FREQ_MIN = 70;     // Hz mapped to bottom of screen
  const FREQ_MAX = 360;    // Hz mapped to top of screen
  const LW = 540, LH = 720;// logical canvas resolution

  const BIRD_X = 152;      
  const BIRD_R = 13;       
  const PIPE_W = 64;       
  const GAP    = 132;      
  const SCROLL = 140;      
  const SPACING = 300;     
  const TRAIL_MAX = 280;   

  const STRINGS = [
    { name:"E2", freq: 82.41 },
    { name:"A2", freq:110.00 },
    { name:"D3", freq:146.83 },
    { name:"G3", freq:196.00 },
    { name:"B3", freq:246.94 },
    { name:"E4", freq:329.63 },
  ];

  // Matched Colors Scheme
  const COL = {
    textMain: "#f8fafc",
    textMuted: "#94a3b8",
    accentGreen: "#22c55e",
    accentRed: "#ef4444",
    accentYellow: "#eab308",
    grid: "rgba(148, 163, 184, 0.04)", 
    line: "rgba(148, 163, 184, 0.12)",
    pipeFill: "rgba(51, 65, 85, 0.35)", 
    bg: "#0f172a",
  };
  const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

  /* =====================================================================
     ELEMENTS
     ===================================================================== */
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const el = id => document.getElementById(id);
  const noteEl=el("note"), freqEl=el("freq"), scoreEl=el("score"),
        centsEl=el("cents"), needle=el("needle"), targetEl=el("target"),
        dotEl=el("dot"), linkEl=el("link"), hintEl=el("hint"),
        overOverlay=el("overOverlay"), finalScore=el("finalScore"), bestScore=el("bestScore");

  /* =====================================================================
     HELPERS
     ===================================================================== */
  const clamp = (v,a,b) => v < a ? a : v > b ? b : v;
  const freqToY = f => LH * (1 - (clamp(f,FREQ_MIN,FREQ_MAX) - FREQ_MIN) / (FREQ_MAX - FREQ_MIN));
  const yToFreq = y => FREQ_MAX - (clamp(y,0,LH) / LH) * (FREQ_MAX - FREQ_MIN);

  function freqToNote(f){
    const midi = 69 + 12 * Math.log2(f / 440);
    const m = Math.round(midi);
    const cents = Math.round((midi - m) * 100);
    const name = NOTE_NAMES[((m % 12) + 12) % 12];
    const octave = Math.floor(m / 12) - 1;
    return { note:name, octave, cents };
  }

  /* =====================================================================
     STATE
     ===================================================================== */
  let state = "playing"; // Skips 'ready' and jumps straight into play mode
  const bird = { x:BIRD_X, y:LH/2 };
  let pipes = [];
  let bag = [];    
  let trail = [];  
  let score = 0, best = 0;

  let ws = null, wsConnected = false;
  let signalFreq = 0;   
  let lastMsg = null;   
  let simFreq = null;   

  /* =====================================================================
     PIPE BAG
     ===================================================================== */
  function refillBag() {
    bag = STRINGS.map((_,i) => i);
    for (let i = bag.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  function nextString(){
    if (bag.length === 0) refillBag();
    return STRINGS[bag.pop()];
  }
  function spawnPipe(){
    const s = nextString();
    pipes.push({ x:LW, string:s, gapY:freqToY(s.freq), counted:false });
  }

  /* =====================================================================
     GAME FLOW
     ===================================================================== */
  function resetGame(){
    pipes = []; bag = []; trail = []; score = 0;
    const f = currentFreq();
    bird.y = (f && f > 0) ? freqToY(f) : LH/2;
  }
  function startGame(){
    resetGame();
    state = "playing";
    overOverlay.hidden = true;
    lastT = performance.now();
  }
  function gameOver(){
    if (state !== "playing") return;
    state = "gameover";
    best = Math.max(best, score);
    finalScore.textContent = score;
    bestScore.textContent = "BEST " + best;
    overOverlay.hidden = false;
  }

  function currentFreq(){
    if (wsConnected) return signalFreq; 
    return simFreq;                        
  }

  /* =====================================================================
     UPDATE
     ===================================================================== */
  let hasSignal = false;
  function update(dt){
    const f = currentFreq();
    hasSignal = (typeof f === "number" && isFinite(f) && f > 0);
    if (hasSignal) bird.y = freqToY(f); 

    trail.push({ x:bird.x, y:bird.y });
    if (trail.length > TRAIL_MAX) trail.shift();
    for (const t of trail) t.x -= SCROLL * dt;
    while (trail.length && trail[0].x < -20) trail.shift();

    if (state !== "playing") return;

    for (const p of pipes) p.x -= SCROLL * dt;

    if (pipes.length === 0 || pipes[pipes.length - 1].x <= LW - SPACING) spawnPipe();

    for (const p of pipes){
      const overlap = bird.x + BIRD_R > p.x && bird.x - BIRD_R < p.x + PIPE_W;
      if (!overlap) continue;
      const top = p.gapY - GAP/2, bot = p.gapY + GAP/2;
      if (bird.y - BIRD_R < top || bird.y + BIRD_R > bot){ gameOver(); return; }
    }

    for (const p of pipes){
      if (!p.counted && p.x + PIPE_W < bird.x - BIRD_R){ p.counted = true; score++; }
    }

    pipes = pipes.filter(p => p.x + PIPE_W > -10);
  }

  /* =====================================================================
     DRAW
     ===================================================================== */
  function targetPipe(){ return pipes.find(p => !p.counted) || null; }

  function draw(){
    ctx.clearRect(0,0,LW,LH);
    ctx.fillStyle = COL.bg; ctx.fillRect(0,0,LW,LH);

    // Dynamic clean matrix lines
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x=0; x<=LW; x+=36){ ctx.moveTo(x+.5,0); ctx.lineTo(x+.5,LH); }
    for (let y=0; y<=LH; y+=36){ ctx.moveTo(0,y+.5); ctx.lineTo(LW,y+.5); }
    ctx.stroke();

    // Staff reference lines
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (const s of STRINGS){
      const y = freqToY(s.freq);
      ctx.strokeStyle = COL.line; ctx.lineWidth = 1;
      ctx.setLineDash([4,6]); ctx.beginPath();
      ctx.moveTo(0, y+.5); ctx.lineTo(LW, y+.5); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(148, 163, 184, 0.45)"; ctx.textAlign = "left";
      ctx.fillText(s.name, 10, y);
    }

    const tgt = targetPipe();
    for (const p of pipes){
      drawPipe(p, (p === tgt));
    }

    // Oscilloscope tail trace
    for (let i=0; i<trail.length; i++){
      const a = (i + 1) / trail.length;
      ctx.globalAlpha = a * 0.4;
      ctx.fillStyle = COL.textMain;
      const r = 1 + a * (BIRD_R * 0.45);
      ctx.beginPath(); ctx.arc(trail[i].x, trail[i].y, r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Player node (the Bird)
    const matching = isMatchingTarget(tgt);
    ctx.globalAlpha = hasSignal ? 1 : 0.4;
    ctx.fillStyle = matching ? COL.accentGreen : COL.textMain;
    ctx.beginPath(); ctx.arc(bird.x, bird.y, BIRD_R, 0, 7); ctx.fill();
    ctx.fillStyle = COL.bg;
    ctx.beginPath(); ctx.arc(bird.x, bird.y, BIRD_R * 0.4, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawPipe(p, isTgt){
    const top = p.gapY - GAP/2;
    const bot = p.gapY + GAP/2;
    const edge = isTgt ? COL.textMain : "#334155";

    ctx.fillStyle = COL.pipeFill;
    ctx.strokeStyle = edge;
    ctx.lineWidth = isTgt ? 2.5 : 1;

    if (top > 0){
      ctx.fillRect(p.x, 0, PIPE_W, top);
      ctx.strokeRect(p.x + .5, .5, PIPE_W - 1, top - 1);
    }
    if (bot < LH){
      ctx.fillRect(p.x, bot, PIPE_W, LH - bot);
      ctx.strokeRect(p.x + .5, bot + .5, PIPE_W - 1, LH - bot - 1);
    }

    ctx.fillStyle = isTgt ? COL.textMain : COL.textMuted;
    ctx.font = "700 16px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(p.string.name, p.x + PIPE_W/2, p.gapY);
  }

  /* =====================================================================
     HUD SYNC (DOM)
     ===================================================================== */
  function readDisplay(){
    if (wsConnected && lastMsg){
      const f = Number(lastMsg.frequency);
      if (isFinite(f) && f > 0){
        const oct = (lastMsg.octave ?? "");
        return { label:`${lastMsg.note ?? "?"}${oct}`, freq:f,
                 cents:Number(lastMsg.cents_off) || 0, valid:true };
      }
      return { label:"—", freq:0, cents:null, valid:false };
    }
    if (typeof simFreq === "number" && simFreq > 0){
      const n = freqToNote(simFreq);
      return { label:`${n.note}${n.octave}`, freq:simFreq, cents:n.cents, valid:true };
    }
    return { label:"—", freq:0, cents:null, valid:false };
  }

  function isMatchingTarget(tgt){
    if (!tgt) return false;
    const d = readDisplay();
    return d.valid && d.label === tgt.string.name && Math.abs(d.cents ?? 99) < 35;
  }

  function syncHud(){
    const d = readDisplay();
    const tgt = targetPipe();

    noteEl.textContent = d.label;
    noteEl.classList.toggle("flat", !d.valid);
    freqEl.textContent = d.valid ? d.freq.toFixed(1) + " Hz" : "—— Hz";
    scoreEl.textContent = score;

    // Tuner layout mapping rules
    if (d.valid && d.cents !== null){
      const c = clamp(d.cents, -50, 50);
      needle.style.left = (50 + (c / 50) * 50) + "%";
      const ac = Math.abs(d.cents);
      const col = ac <= 5 ? "var(--accent-green)" : ac <= 15 ? "var(--accent-yellow)" : "var(--accent-red)";
      needle.style.background = col;
      centsEl.style.color = col;
      centsEl.textContent = (d.cents > 0 ? "+" : "") + d.cents + "¢";
    } else {
      needle.style.left = "50%";
      needle.style.background = "#475569";
      centsEl.style.color = "var(--text-muted)";
      centsEl.textContent = "—";
    }

    targetEl.textContent = tgt ? tgt.string.name : "—";
    targetEl.classList.toggle("hit", isMatchingTarget(tgt));

    if (wsConnected){
      dotEl.className = "dot live"; linkEl.textContent = "LIVE";
      hintEl.textContent = "Play your guitar's open strings";
    } else {
      dotEl.className = "dot sim"; linkEl.textContent = "SIM MODE";
      hintEl.textContent = "Drag display area • Keys 1–6 = Strings";
    }
  }

  /* =====================================================================
     MAIN LOOP
     ===================================================================== */
  let lastT = performance.now();
  function loop(now){
    const dt = Math.min((now - lastT) / 1000, 0.05); 
    lastT = now;
    update(dt);
    draw();
    syncHud();
    requestAnimationFrame(loop);
  }

  /* =====================================================================
     WEBSOCKET
     ===================================================================== */
  function connect(){
    let socket;
    try { socket = new WebSocket(`ws://192.168.4.1/ws`); }
    catch (e) { scheduleReconnect(); return; }
    ws = socket;
 
    socket.onopen = () => { wsConnected = true; };
    socket.onclose = () => {
      if (ws === socket){ wsConnected = false; signalFreq = 0; lastMsg = null; }
      scheduleReconnect();
    };
    socket.onerror = () => {}; 
    socket.onmessage = ev => {
      try {
        const d = JSON.parse(ev.data);
        lastMsg = d;
        const f = Number(d.frequency);
        signalFreq = (isFinite(f) && f > 0) ? f : 0;
      } catch (e) {}
    };
  }
  let reconnectTimer = null;
  function scheduleReconnect(){
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  }

  /* =====================================================================
     INPUT
     ===================================================================== */
  function pointerToFreq(clientX, clientY){
    const r = canvas.getBoundingClientRect();
    const yFrac = (clientY - r.top) / r.height;
    simFreq = clamp(yToFreq(yFrac * LH), FREQ_MIN, FREQ_MAX);
  }
  canvas.addEventListener("pointermove", e => { if (!wsConnected) pointerToFreq(e.clientX, e.clientY); });
  canvas.addEventListener("pointerdown", e => { if (!wsConnected) pointerToFreq(e.clientX, e.clientY); });

  window.addEventListener("keydown", e => {
    if (e.code === "Space" || e.key === " "){ 
        e.preventDefault(); 
        if (state === "gameover") startGame();
        return; 
    }
    if (!wsConnected){
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 6) simFreq = STRINGS[n - 1].freq;
    }
  });

  el("againBtn").addEventListener("click", e => { e.stopPropagation(); startGame(); });
  overOverlay.addEventListener("click", () => { if (state === "gameover") startGame(); });

  /* =====================================================================
     CANVAS SIZING
     ===================================================================== */
  function fitCanvas(){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.round(LW * dpr);
    canvas.height = Math.round(LH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", fitCanvas);

  /* =====================================================================
     INIT
     ===================================================================== */
  fitCanvas();
  connect();
  resetGame(); 
  requestAnimationFrame(loop);
})();