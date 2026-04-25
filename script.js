const canvas = document.getElementById('face');
const ctx = canvas.getContext('2d');

const micBtn = document.getElementById('micBtn');
const emotionSelect = document.getElementById('emotionSelect');
const heardText = document.getElementById('heardText');
const replyText = document.getElementById('replyText');

let currentEmotion = 'neutral';
let isSpeaking = false;
let mouthOpenFactor = 0;

const bounds = {
  leftEyeOuter: { x: 95, y: 85, w: 200, h: 330 },
  rightEyeOuter: { x: 605, y: 85, w: 200, h: 330 },
  leftEyeInner: { x: 165, y: 185, w: 65, h: 145 },
  rightEyeInner: { x: 675, y: 185, w: 65, h: 145 },
  mouth: { x: 20, y: 455, w: 860, h: 95 },
};

function drawRect(x, y, w, h, thickness = 10) {
  ctx.lineWidth = thickness;
  ctx.strokeStyle = '#fff';
  ctx.strokeRect(x, y, w, h);
}

function drawFace(emotion = currentEmotion) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawRect(bounds.leftEyeOuter.x, bounds.leftEyeOuter.y, bounds.leftEyeOuter.w, bounds.leftEyeOuter.h);
  drawRect(bounds.rightEyeOuter.x, bounds.rightEyeOuter.y, bounds.rightEyeOuter.w, bounds.rightEyeOuter.h);

  const blinkAmount = emotion === 'thinking' ? 0.5 : 0;
  const leftInnerHeight = bounds.leftEyeInner.h * (1 - blinkAmount);
  const rightInnerHeight = bounds.rightEyeInner.h * (1 - blinkAmount);

  drawRect(bounds.leftEyeInner.x, bounds.leftEyeInner.y + (bounds.leftEyeInner.h - leftInnerHeight), bounds.leftEyeInner.w, leftInnerHeight);
  drawRect(bounds.rightEyeInner.x, bounds.rightEyeInner.y + (bounds.rightEyeInner.h - rightInnerHeight), bounds.rightEyeInner.w, rightInnerHeight);

  drawMouth(emotion);
}

function drawMouth(emotion) {
  const { x, y, w, h } = bounds.mouth;

  if (emotion === 'happy') {
    drawRect(x, y + 8, w, h - 8, 10);
  } else if (emotion === 'sad') {
    drawRect(x, y + 30, w, h - 35, 10);
  } else if (emotion === 'surprised') {
    const centerW = Math.max(220, 220 + mouthOpenFactor * 220);
    drawRect(x + (w - centerW) / 2, y + 8, centerW, h - 14, 10);
  } else if (emotion === 'angry') {
    drawRect(x, y + 18, w, h - 28, 10);
    ctx.beginPath();
    ctx.moveTo(x + 40, y + 10);
    ctx.lineTo(x + 150, y - 25);
    ctx.moveTo(x + w - 40, y + 10);
    ctx.lineTo(x + w - 150, y - 25);
    ctx.stroke();
  } else {
    const openBoost = isSpeaking ? mouthOpenFactor * 36 : 0;
    drawRect(x, y + 10 + (20 - openBoost), w, h - 25 + openBoost, 10);
  }
}

function animate() {
  if (isSpeaking) {
    mouthOpenFactor = 0.35 + 0.65 * Math.abs(Math.sin(Date.now() / 120));
  } else {
    mouthOpenFactor *= 0.82;
  }

  drawFace();
  requestAnimationFrame(animate);
}

function setEmotion(emotion) {
  currentEmotion = emotion;
  emotionSelect.value = emotion;
}

function getBotReply(input) {
  const text = input.toLowerCase();

  if (/hello|hi|hey/.test(text)) {
    setEmotion('happy');
    return 'Hey there! Nice to meet you.';
  }
  if (/sad|bad|upset/.test(text)) {
    setEmotion('sad');
    return 'I am here for you. Want to talk about it?';
  }
  if (/angry|mad/.test(text)) {
    setEmotion('thinking');
    return 'Take a deep breath with me. In... and out.';
  }
  if (/joke|funny/.test(text)) {
    setEmotion('happy');
    return 'Why did the robot cross the road? Because it was programmed by the chicken!';
  }
  if (/surprise|wow/.test(text)) {
    setEmotion('surprised');
    return 'Whoa! That is surprising.';
  }

  setEmotion('neutral');
  return 'I heard you. Tell me more!';
}

function speak(text) {
  if (!window.speechSynthesis) {
    replyText.textContent = `${text} (Speech synthesis not available in this browser)`;
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = currentEmotion === 'happy' ? 1.15 : 1;

  utterance.onstart = () => {
    isSpeaking = true;
  };
  utterance.onend = () => {
    isSpeaking = false;
  };

  window.speechSynthesis.speak(utterance);
}

function buildRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    micBtn.disabled = true;
    micBtn.textContent = 'Speech recognition unsupported';
    replyText.textContent = 'Your browser does not support microphone speech recognition.';
    return null;
  }

  const recognition = new SR();
  recognition.lang = 'en-US';
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    micBtn.textContent = '🎤 Listening...';
  };

  recognition.onend = () => {
    micBtn.textContent = '🎤 Start listening';
  };

  recognition.onerror = (event) => {
    replyText.textContent = `Microphone error: ${event.error}`;
    setEmotion('sad');
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim();
    heardText.textContent = transcript;

    const reply = getBotReply(transcript);
    replyText.textContent = reply;
    speak(reply);
  };

  return recognition;
}

const recognition = buildRecognition();

micBtn.addEventListener('click', () => {
  if (!recognition) return;

  try {
    recognition.start();
    setEmotion('thinking');
  } catch {
    // Browser throws if start is called while already active.
  }
});

emotionSelect.addEventListener('change', (event) => {
  setEmotion(event.target.value);
});

setEmotion('neutral');
animate();
