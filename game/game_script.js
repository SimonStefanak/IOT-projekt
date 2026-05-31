const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const octaves = [2, 3, 4, 5];


let targetNote = "";
let targetOctave = 0;
let correct = false;
let level = 0;
let attempts = 0;

function pickRandomNote() {
    targetNote = notes[Math.floor(Math.random() * notes.length)];
    targetOctave = octaves[Math.floor(Math.random() * octaves.length)];
    document.getElementById("target").textContent = targetNote + targetOctave;
    document.getElementById("btn").classList.remove("correct");
    correct = false;
}

function nextNote() {
    if (correct) {
    level++;
    document.getElementById("cents").textContent = "";
    
    if (level >= 2) {
    document.body.innerHTML = `
        <h1>Congratulations!</h1>
        <p>You completed all 5 levels in ${attempts} attempts.</p>
        <button onclick="location.reload()" id="againBtn">Play Again</button>
    `;
    return;
    }
    
    pickRandomNote();
  }
}

const ws = new WebSocket("ws://192.168.100.34/ws");

ws.onmessage = (event) => {
    console.log(event.data); 
    const data = JSON.parse(event.data);
    attempts++;

    document.getElementById("cents").textContent = data.cents_off + " cents";

    if (data.note === targetNote && data.octave === targetOctave && Math.abs(data.cents_off) <= 15) {
        document.getElementById("btn").classList.add("correct");
        correct = true;
    }
};

pickRandomNote();
