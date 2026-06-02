const ws = new WebSocket("ws://192.168.1.47/ws");
const canvas = document.getElementById('gauge');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const cx = W / 2, cy = H - 20;
const R = 150;

function drawGauge(cents) {
  ctx.clearRect(0, 0, W, H);

  for (let i = -50; i <= 50; i += 5) {
    const angle = Math.PI + (i + 50) / 100 * Math.PI;
    const isMajor = i % 10 === 0;
    const innerR = isMajor ? R - 16 : R - 8;
    const x1 = cx + innerR * Math.cos(angle);
    const y1 = cy + innerR * Math.sin(angle);
    const x2 = cx + R * Math.cos(angle);
    const y2 = cy + R * Math.sin(angle);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = i === 0 ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    if (isMajor) {
      const labelR = R - 28;
      const lx = cx + labelR * Math.cos(angle);
      const ly = cy + labelR * Math.sin(angle);
      ctx.fillStyle = '#000';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(i === 0 ? '0' : (i > 0 ? '+' + i : i), lx, ly);
    }
  }

  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, R + 2, Math.PI, 0);
  ctx.stroke();

  const needleAngle = Math.PI + (cents + 50) / 100 * Math.PI;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + (R - 8) * Math.cos(needleAngle), cy + (R - 8) * Math.sin(needleAngle));
  ctx.stroke();

  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#555';
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('-50', 10, cy - 5);
  ctx.textAlign = 'right';
  ctx.fillText('+50', W - 10, cy - 5);
}

function updateCents(cents) {
  drawGauge(cents);
  const el = document.getElementById('centsVal');
  if (cents === 0) {
    el.style.color = '#39ff6a';
    el.textContent = 'in tune';
  } else if (Math.abs(cents) <= 15) {
    el.style.color = '#ffcc00';
    el.textContent = (cents > 0 ? '+' : '') + cents + ' cents ' + (cents > 0 ? '(sharp)' : '(flat)');
  } else {
    el.style.color = '#ff3a3a';
    el.textContent = (cents > 0 ? '+' : '') + cents + ' cents ' + (cents > 0 ? '(sharp)' : '(flat)');
  }
}



ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  document.getElementById('noteName').textContent = data.note + data.octave;
  document.getElementById('freqVal').textContent = data.frequency.toFixed(1) + ' Hz';
  updateCents(data.cents_off);
};

drawGauge(0);


