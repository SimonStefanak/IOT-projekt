const ws = new WebSocket(`ws://${location.host}/ws`);

const canvas = document.getElementById('gauge');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const cx = W / 2, cy = H - 20;
const R = 150;

// Theme Colors mapped for Canvas Engine
const colors = {
    tickDefault: '#475569',    // slate-600
    textDefault: '#94a3b8',    // slate-400
    arcTrack: '#334155',       // slate-700
    bgCard: '#1e293b',         // matches container bg
    outOfTune: '#ef4444',      // var(--accent-red)
    closeToTune: '#eab308',    // var(--accent-yellow)
    inTune: '#22c55e'          // var(--accent-green)
};

function getTuningColor(cents) {
    if (cents === 0) return colors.inTune;
    if (Math.abs(cents) <= 15) return colors.closeToTune;
    return colors.outOfTune;
}

function drawGauge(cents) {
    ctx.clearRect(0, 0, W, H);
    const activeColor = getTuningColor(cents);

    // 1. Draw Ticks & Outer Ring Labels
    for (let i = -50; i <= 50; i += 5) {
        const angle = Math.PI + (i + 50) / 100 * Math.PI;
        const isMajor = i % 10 === 0;
        const innerR = isMajor ? R - 14 : R - 8;
        
        const x1 = cx + innerR * Math.cos(angle);
        const y1 = cy + innerR * Math.sin(angle);
        const x2 = cx + R * Math.cos(angle);
        const y2 = cy + R * Math.sin(angle);
        
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        
        // Highlight the absolute center (0 cents marker)
        if (i === 0) {
            ctx.strokeStyle = colors.inTune;
            ctx.lineWidth = 3;
        } else {
            ctx.strokeStyle = colors.tickDefault;
            ctx.lineWidth = isMajor ? 1.5 : 1;
        }
        ctx.stroke();

        if (isMajor) {
            const labelR = R - 26;
            const lx = cx + labelR * Math.cos(angle);
            const ly = cy + labelR * Math.sin(angle);
            
            ctx.fillStyle = colors.textDefault;
            ctx.font = '500 11px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(i === 0 ? '0' : (i > 0 ? '+' + i : i), lx, ly);
        }
    }

    // 2. Draw Arc Base Rim
    ctx.strokeStyle = colors.arcTrack;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 2, Math.PI, 0);
    ctx.stroke();

    // 3. Draw Dynamic Tuning Needle
    const constrainedCents = Math.max(-50, Math.min(50, cents));
    const needleAngle = Math.PI + (constrainedCents + 50) / 100 * Math.PI;
    
    ctx.strokeStyle = activeColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + (R - 6) * Math.cos(needleAngle), cy + (R - 6) * Math.sin(needleAngle));
    ctx.stroke();

    // 4. Center Anchor Pin
    ctx.fillStyle = colors.bgCard;
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = activeColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.stroke();

    // 5. Corner Labels (-50 / +50)
    ctx.fillStyle = colors.textDefault;
    ctx.font = '600 12px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('-50', 12, cy - 2);
    ctx.textAlign = 'right';
    ctx.fillText('+50', W - 12, cy - 2);
}

function updateCents(cents) {
    // Force conversion to a safe number to prevent string concatenation bugs
    const centsNum = Number(cents) || 0; 
    
    drawGauge(centsNum);
    const el = document.getElementById('centsVal');
    
    if (centsNum === 0) {
        el.style.color = colors.inTune;
        el.textContent = 'In Tune';
    } else {
        const toneState = centsNum > 0 ? 'sharp' : 'flat';
        const formattedCents = (centsNum > 0 ? '+' : '') + centsNum;
        
        el.style.color = getTuningColor(centsNum);
        el.textContent = `${formattedCents} cents (${toneState})`;
    }
}

ws.onmessage = (event) => {
    try {
        const data = JSON.parse(event.data);
        console.log("WebSocket Data Received:", data); // View this in your browser inspect console

        // 1. Safely parse Note and Octave
        const note = data.note || '--';
        const octave = data.octave !== undefined ? data.octave : '';
        document.getElementById('noteName').textContent = note + octave;

        // 2. Prevent crash if frequency is missing or not a number
        if (data.frequency !== undefined && data.frequency !== null) {
            const freqNum = Number(data.frequency);
            document.getElementById('freqVal').textContent = !isNaN(freqNum) 
                ? freqNum.toFixed(1) + ' Hz' 
                : '0.0 Hz';
        } else {
            document.getElementById('freqVal').textContent = '--- Hz';
        }

        // 3. Safely pass cents_off (fallback to 0 if missing)
        const centsOff = data.cents_off !== undefined ? Number(data.cents_off) : 0;
        updateCents(centsOff);

    } catch (error) {
        console.error("Error processing WebSocket message:", error);
    }
};

// Initial state load
drawGauge(0);