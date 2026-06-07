"use strict";
(() => {
  /* =====================================================================
     CONFIG — tweak freely
     ===================================================================== */
  const FREQ_MIN = 70;     // Hz mapped to bottom of screen
  const FREQ_MAX = 360;    // Hz mapped to top of screen
  const LW = 540, LH = 720;// logical canvas resolution (drawing coords)

  const BIRD_X = 152;      // fixed horizontal position of the bird
  const BIRD_R = 13;       // bird radius (also used for collision)
  const PIPE_W = 64;       // pipe width (px)
  const GAP    = 132;      // gap height (px) — bigger = more forgiving
  const SCROLL = 140;      // pipe scroll speed (px / second)
  const SPACING = 300;     // horizontal distance between consecutive pipes
  const TRAIL_MAX = 280;   // max points in the signal trace

  // Open guitar strings, low -> high. Each becomes a pipe.
  const STRINGS = [
    { name:"E2", freq: 82.41 },
    { name:"A2", freq:110.00 },
    { name:"D3", freq:146.83 },
    { name:"G3", freq:196.00 },
    { name:"B3", freq:246.94 },
    { name:"E4", freq:329.63 },
  ];

  const COL = {
    phosphor:"#dddddd", phosphorDim:"#555555", amber:"#ffffff",
    white:"#ffffff", grid:"rgba(255,255,255,0.04)", line:"rgba(255,255,255,0.10)",
    fill:"rgba(255,255,255,0.06)", bg:"#080808",
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
        startOverlay=el("startOverlay"), overOverlay=el("overOverlay"),
        startMode=el("startMode"), finalScore=el("finalScore"),
        bestScore=el("bestScore");

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
  let state = "ready";            // ready | playing | gameover
  const bird = { x:BIRD_X, y:LH/2 };
  let pipes = [];
  let bag = [];                   // shuffled queue of string indices
  let trail = [];                 // signal trace points {x,y}
  let score = 0, best = 0;

  // signal sources
  let ws = null, wsConnected = false;
  let signalFreq = 0;             // last freq from WebSocket (0 = none)
  let lastMsg = null;             // last full WS payload
  let simFreq = null;             // simulated freq (mouse / keys), used only when offline

  /* =====================================================================
     PIPE BAG (random order, reshuffled after all 6 used)
     ===================================================================== */
  function refillBag(){
    bag = STRINGS.map((_,i) => i);
    for (let i = bag.length - 1; i > 0; i--){      // Fisher–Yates
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
    startOverlay.hidden = true;
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
  function primaryAction(){
    if (state === "ready") startGame();
    else if (state === "gameover") startGame();
  }

  /* =====================================================================
     SIGNAL: choose effective frequency this frame
     ===================================================================== */
  function currentFreq(){
    if (wsConnected) return signalFreq;   // live: 0/none when silent
    return simFreq;                        // offline test mode
  }

  /* =====================================================================
     UPDATE
     ===================================================================== */
  let hasSignal = false;
  function update(dt){
    // --- Bird height locked to frequency (no gravity / physics) ---
    const f = currentFreq();
    hasSignal = (typeof f === "number" && isFinite(f) && f > 0);
    if (hasSignal) bird.y = freqToY(f);   // else: stay at last position

    // --- Signal trace (sweeps left like an oscilloscope) ---
    trail.push({ x:bird.x, y:bird.y });
    if (trail.length > TRAIL_MAX) trail.shift();
    for (const t of trail) t.x -= SCROLL * dt;
    while (trail.length && trail[0].x < -20) trail.shift();

    if (state !== "playing") return;

    // --- Move pipes ---
    for (const p of pipes) p.x -= SCROLL * dt;

    // --- Spawn (distance based, frame-rate independent) ---
    if (pipes.length === 0 || pipes[pipes.length - 1].x <= LW - SPACING) spawnPipe();

    // --- Collisions ---
    for (const p of pipes){
      const overlap = bird.x + BIRD_R > p.x && bird.x - BIRD_R < p.x + PIPE_W;
      if (!overlap) continue;
      const top = p.gapY - GAP/2, bot = p.gapY + GAP/2;
      if (bird.y - BIRD_R < top || bird.y + BIRD_R > bot){ gameOver(); return; }
    }

    // --- Scoring (count once the pipe clears the bird) ---
    for (const p of pipes){
      if (!p.counted && p.x + PIPE_W < bird.x - BIRD_R){ p.counted = true; score++; }
    }

    // --- Cull off-screen pipes ---
    pipes = pipes.filter(p => p.x + PIPE_W > -10);
  }

  /* =====================================================================
     DRAW
     ===================================================================== */
  function targetPipe(){ return pipes.find(p => !p.counted) || null; }

  function draw(){
    ctx.clearRect(0,0,LW,LH);
    ctx.fillStyle = COL.bg; ctx.fillRect(0,0,LW,LH);

    // grid
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x=0; x<=LW; x+=36){ ctx.moveTo(x+.5,0); ctx.lineTo(x+.5,LH); }
    for (let y=0; y<=LH; y+=36){ ctx.moveTo(0,y+.5); ctx.lineTo(LW,y+.5); }
    ctx.stroke();

    // string reference lines + labels (the "staff")
    ctx.font = "600 10px " + getMono();
    ctx.textBaseline = "middle";
    for (const s of STRINGS){
      const y = freqToY(s.freq);
      ctx.strokeStyle = COL.line; ctx.lineWidth = 1;
      ctx.setLineDash([2,6]); ctx.beginPath();
      ctx.moveTo(0, y+.5); ctx.lineTo(LW, y+.5); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.textAlign = "left";
      ctx.fillText(s.name, 7, y);
    }

    // pipes
    const tgt = targetPipe();
    for (const p of pipes){
      const isTgt = (p === tgt);
      drawPipe(p, isTgt);
    }

    // signal trace
    for (let i=0; i<trail.length; i++){
      const a = (i + 1) / trail.length;
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = COL.phosphor;
      const r = 1 + a * (BIRD_R * 0.45);
      ctx.beginPath(); ctx.arc(trail[i].x, trail[i].y, r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // bird
    const matching = isMatchingTarget(tgt);
    ctx.globalAlpha = hasSignal ? 1 : 0.4;
    ctx.fillStyle = matching ? COL.amber : COL.phosphor;
    ctx.beginPath(); ctx.arc(bird.x, bird.y, BIRD_R, 0, 7); ctx.fill();
    ctx.fillStyle = "#080808";
    ctx.beginPath(); ctx.arc(bird.x, bird.y, BIRD_R * 0.42, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawPipe(p, isTgt){
    const top = p.gapY - GAP/2;
    const bot = p.gapY + GAP/2;
    const edge = isTgt ? "#ffffff" : "#444444";

    ctx.fillStyle = COL.fill;
    ctx.strokeStyle = edge;
    ctx.lineWidth = isTgt ? 2 : 1;

    // top band
    if (top > 0){
      ctx.fillRect(p.x, 0, PIPE_W, top);
      ctx.strokeRect(p.x + .5, .5, PIPE_W - 1, top - 1);
    }
    // bottom band
    if (bot < LH){
      ctx.fillRect(p.x, bot, PIPE_W, LH - bot);
      ctx.strokeRect(p.x + .5, bot + .5, PIPE_W - 1, LH - bot - 1);
    }

    // gap label (the string you must play)
    ctx.fillStyle = edge;
    ctx.font = (isTgt ? "700 " : "600 ") + "16px " + getMono();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(p.string.name, p.x + PIPE_W/2, p.gapY);
  }

  /* =====================================================================
     HUD SYNC (DOM)
     ===================================================================== */
  function readDisplay(){
    // returns {label, freq, cents, valid}
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

    // tuner needle
    if (d.valid && d.cents !== null){
      const c = clamp(d.cents, -50, 50);
      needle.style.left = (50 + (c / 50) * 50) + "%";
      const ac = Math.abs(d.cents);
      const col = ac <= 5 ? "#ffffff" : ac <= 15 ? "#aaaaaa" : "#666666";
      needle.style.background = col;
      needle.style.boxShadow = "none";
      centsEl.style.color = col;
      centsEl.textContent = (d.cents > 0 ? "+" : "") + d.cents + "¢";
    } else {
      needle.style.left = "50%";
      needle.style.background = COL.phosphorDim;
      needle.style.boxShadow = "none";
      centsEl.style.color = COL.dim || "#4c6b5b";
      centsEl.textContent = "—";
    }

    // target
    targetEl.textContent = tgt ? tgt.string.name : "—";
    targetEl.classList.toggle("hit", isMatchingTarget(tgt));

    // status
    if (wsConnected){
      dotEl.className = "dot live"; linkEl.textContent = "LIVE";
      hintEl.textContent = "play your guitar's open strings";
    } else {
      dotEl.className = "dot sim"; linkEl.textContent = "SIM";
      hintEl.textContent = "SIM · drag on screen · keys 1–6 = strings";
    }
  }

  /* =====================================================================
     MAIN LOOP
     ===================================================================== */
  let lastT = performance.now();
  function loop(now){
    const dt = Math.min((now - lastT) / 1000, 0.05); // clamp big gaps
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
    try { socket = new WebSocket(`ws://${location.host}/ws`); }
    catch (e) { scheduleReconnect(); return; }
    ws = socket;

    socket.onopen = () => { wsConnected = true; updateStartMode(); };
    socket.onclose = () => {
      if (ws === socket){ wsConnected = false; signalFreq = 0; lastMsg = null; updateStartMode(); }
      scheduleReconnect();
    };
    socket.onerror = () => {}; // close handler will fire
    socket.onmessage = ev => {
      try {
        const d = JSON.parse(ev.data);
        lastMsg = d;
        const f = Number(d.frequency);
        signalFreq = (isFinite(f) && f > 0) ? f : 0;
      } catch (e) { /* ignore malformed frames */ }
    };
  }
  let reconnectTimer = null;
  function scheduleReconnect(){
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  }
  function updateStartMode(){
    if (wsConnected){
      startMode.textContent = "● ESP32 connected — live pitch input";
      startMode.classList.add("live");
    } else {
      startMode.textContent = "No ESP32 detected — SIM mode (drag on screen, or keys 1–6)";
      startMode.classList.remove("live");
    }
  }

  /* =====================================================================
     INPUT
     ===================================================================== */
  // SIM: move/drag over the screen sets pitch (only when offline)
  function pointerToFreq(clientX, clientY){
    const r = canvas.getBoundingClientRect();
    const yFrac = (clientY - r.top) / r.height;
    simFreq = clamp(yToFreq(yFrac * LH), FREQ_MIN, FREQ_MAX);
  }
  canvas.addEventListener("pointermove", e => { if (!wsConnected) pointerToFreq(e.clientX, e.clientY); });
  canvas.addEventListener("pointerdown", e => { if (!wsConnected) pointerToFreq(e.clientX, e.clientY); });

  // Keyboard: Space = start/restart; 1–6 snap to each string (SIM only)
  window.addEventListener("keydown", e => {
    if (e.code === "Space" || e.key === " "){ e.preventDefault(); primaryAction(); return; }
    if (!wsConnected){
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 6) simFreq = STRINGS[n - 1].freq;
    }
  });

  // Buttons / tap-to-start
  el("startBtn").addEventListener("click", e => { e.stopPropagation(); startGame(); });
  el("againBtn").addEventListener("click", e => { e.stopPropagation(); startGame(); });
  startOverlay.addEventListener("click", () => { if (state === "ready") startGame(); });
  overOverlay.addEventListener("click", () => { if (state === "gameover") startGame(); });

  /* =====================================================================
     CANVAS SIZING (crisp on hi-dpi, fixed logical coordinates)
     ===================================================================== */
  let _mono = null;
  function getMono(){ return _mono || (_mono = getComputedStyle(document.body).fontFamily); }
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
  // build the string reference chips on the start screen
  el("chips").innerHTML = STRINGS
    .map(s => `<span class="chip">${s.name} <span>${s.freq.toFixed(s.freq % 1 ? 2 : 0)} Hz</span></span>`)
    .join("");

  fitCanvas();
  updateStartMode();
  connect();
  requestAnimationFrame(loop);
})();