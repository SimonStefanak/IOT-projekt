const strings = [
  { note: "E", octave: 2 },
  { note: "A", octave: 2 },
  { note: "D", octave: 3 },
  { note: "G", octave: 3 },
  { note: "B", octave: 3 },
  { note: "E", octave: 4 }
];
const octaves = [2, 3, 4, 5];


let targetNote = "";
let targetOctave = 0;
let correct = false;
let level = 0;
let attempts = 0;

function pickNote() {
  targetNote = strings[level].note;
  targetOctave = strings[level].octave;
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
    
    pickNote();
  }
}

const ws = new WebSocket("ws://172.20.10.10/ws");

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

pickNote();