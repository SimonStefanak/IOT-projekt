const ws = new WebSocket(`ws://${location.host}/ws`);

const TUNINGS = {
  "Standard":    [{note:"E",octave:2},{note:"A",octave:2},{note:"D",octave:3},{note:"G",octave:3},{note:"B",octave:3},{note:"E",octave:4}],
  "Eb Standard": [{note:"Eb",octave:2},{note:"Ab",octave:2},{note:"Db",octave:3},{note:"Gb",octave:3},{note:"Bb",octave:3},{note:"Eb",octave:4}],
  "Drop D":      [{note:"D",octave:2},{note:"A",octave:2},{note:"D",octave:3},{note:"G",octave:3},{note:"B",octave:3},{note:"E",octave:4}],
  "D Standard":  [{note:"D",octave:2},{note:"G",octave:2},{note:"C",octave:3},{note:"F",octave:3},{note:"A",octave:3},{note:"D",octave:4}],
  "Db Standard": [{note:"Db",octave:2},{note:"Gb",octave:2},{note:"B",octave:2},{note:"E",octave:3},{note:"Ab",octave:3},{note:"Db",octave:4}],
  "Drop C":      [{note:"C",octave:2},{note:"G",octave:2},{note:"C",octave:3},{note:"F",octave:3},{note:"A",octave:3},{note:"D",octave:4}],
};

let activeStrings = TUNINGS["Standard"];
const TOTAL_LEVELS = 5;

let targetNote = "";
let targetOctave = 0;
let correct = false;
let level = 1;

function pickRandomNote() {
    const s = activeStrings[Math.floor(Math.random() * activeStrings.length)];
    targetNote = s.note;
    targetOctave = s.octave;

    document.getElementById("target").textContent = targetNote + targetOctave;
    document.querySelector(".target-section").classList.remove("correct");
    
    const btn = document.getElementById("btn");
    btn.classList.remove("correct-ready");
    btn.disabled = true;
    btn.textContent = "Play the correct note";
    
    correct = false;
}

function nextNote() {
    if (correct) {
        level++;
        document.getElementById("cents").textContent = "0 cents";
        document.getElementById("needle").style.left = "50%";
        document.getElementById("needle").style.backgroundColor = "var(--accent-red)";
        
        if (level > TOTAL_LEVELS) {
            document.body.innerHTML = `
                <div class="game-container">
                    <h1 style="font-size: 2.5rem; margin-bottom: 0.5rem; color: var(--accent-green);">🎉 Victory!</h1>
                    <p style="color: var(--text-muted); margin-bottom: 2rem;">You completed all ${TOTAL_LEVELS} levels.</p>
                    <button onclick="location.reload()" id="againBtn">Play Again</button>
                </div>
            `;
            return;
        }
        
        document.getElementById("level-display").textContent = `Level: ${level}/${TOTAL_LEVELS}`;
        pickRandomNote();
    }
}

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.event === "init" || data.event === "tuning_changed") {
        if (TUNINGS[data.tuning_name]) {
            activeStrings = TUNINGS[data.tuning_name];
            pickRandomNote(); // nová nota z nového tuningu
        }
        return;
    }
    

    // Limit cents to a max/min mapping boundary (-50 to +50 cents)
    const cents = Math.max(-50, Math.min(50, data.cents_off));
    document.getElementById("cents").textContent = `${data.cents_off > 0 ? '+' : ''}${data.cents_off} cents`;

    // Map -50/50 cents dynamically to 0% - 100% width on the meter slider
    const needlePositionPercentage = ((cents + 50) / 100) * 100;
    const needle = document.getElementById("needle");
    needle.style.left = `${needlePositionPercentage}%`;

    // Check tuning precision
    const isCorrectNote = data.note === targetNote && data.octave === targetOctave;
    const isInTune = Math.abs(data.cents_off) <= 15;

    if (isCorrectNote && isInTune) {
        needle.style.backgroundColor = "var(--accent-green)";
        document.querySelector(".target-section").classList.add("correct");
        
        const btn = document.getElementById("btn");
        btn.classList.add("correct-ready");
        btn.disabled = false;
        btn.textContent = "Next Level →";
        
        correct = true;
    } else {
        needle.style.backgroundColor = "var(--accent-red)";
    }
};

// Initialize Game
pickRandomNote();