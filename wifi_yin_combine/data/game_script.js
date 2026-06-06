const ws = new WebSocket(`ws://${location.host}/ws`);

const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const octaves = [2, 3, 4, 5];
const TOTAL_LEVELS = 5;

let targetNote = "";
let targetOctave = 0;
let correct = false;
let level = 1;
let attempts = 0;

function pickRandomNote() {
    targetNote = notes[Math.floor(Math.random() * notes.length)];
    targetOctave = octaves[Math.floor(Math.random() * octaves.length)];
    
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
                    <p style="color: var(--text-muted); margin-bottom: 2rem;">You completed all ${TOTAL_LEVELS} levels in <strong>${attempts}</strong> total attempts.</p>
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
    console.log(event.data); 
    const data = JSON.parse(event.data);
    
    attempts++;
    document.getElementById("attempts-display").textContent = `Attempts: ${attempts}`;

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