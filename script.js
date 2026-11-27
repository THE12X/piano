// --- Audio System & Global State ---
let audioCtx;

// Routing Nodes
let preMasterBus;
let masterGain;
let compressor;
let analyser;

// FX Nodes
let delayNode;
let feedbackGain;
let delayMixGain;

// Recording Setup
let mediaStreamDestination;
let mediaRecorder;
let recordedChunks = [];
let isRecording = false;

const activeOscillators = {};
let currentWaveform = "sine";

// UI Elements
const display = document.getElementById("display");
const waveBtns = document.querySelectorAll(".wave-btn");
const attackSlider = document.getElementById("attack");
const decaySlider = document.getElementById("decay");
const pitchSlider = document.getElementById("pitch");
const volSlider = document.getElementById("volume");
const recordBtn = document.getElementById("record-btn");

// Delay UI Elements
const delayTimeSlider = document.getElementById("delay-time");
const delayFbSlider = document.getElementById("delay-feedback");
const delayMixSlider = document.getElementById("delay-mix");

// Canvas Elements
const canvas = document.getElementById("oscilloscope");
const canvasCtx = canvas.getContext("2d");

// UI Labels
const atkVal = document.getElementById("atk-val");
const decVal = document.getElementById("dec-val");
const pitchVal = document.getElementById("pitch-val");
const volVal = document.getElementById("vol-val");
const delayTimeVal = document.getElementById("delay-time-val");
const delayFbVal = document.getElementById("delay-fb-val");
const delayMixVal = document.getElementById("delay-mix-val");

// Key Mapping (Computer Keyboard -> Piano Note)
const keyMap = {
  a: "C4",
  w: "C#4",
  s: "D4",
  e: "D#4",
  d: "E4",
  f: "F4",
  t: "F#4",
  g: "G4",
  y: "G#4",
  h: "A4",
  u: "A#4",
  j: "B4",
  k: "C5",
  o: "C#5",
  l: "D5",
  p: "D#5",
  ";": "E5",
};

// Initialize Audio Context and Node Graph on first interaction
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Core Buses
    preMasterBus = audioCtx.createGain();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = volSlider.value;

    // Compressor to prevent loud clipping from heavy delays
    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.knee.value = 40;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.25;

    // Delay FX Nodes
    delayNode = audioCtx.createDelay(3.0); // max 3 seconds
    delayNode.delayTime.value = parseFloat(delayTimeSlider.value);

    feedbackGain = audioCtx.createGain();
    feedbackGain.gain.value = parseFloat(delayFbSlider.value);

    delayMixGain = audioCtx.createGain();
    delayMixGain.gain.value = parseFloat(delayMixSlider.value);

    // Audio Routing: Dry Path
    preMasterBus.connect(masterGain);

    // Audio Routing: Delay Wet Path & Feedback Loop
    preMasterBus.connect(delayNode);
    delayNode.connect(feedbackGain);
    feedbackGain.connect(delayNode); // Loop back on itself
    delayNode.connect(delayMixGain); // Output wet signal
    delayMixGain.connect(masterGain); // Mix back to master

    // Master -> Compressor
    masterGain.connect(compressor);

    // Analyser for Visualizer
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    compressor.connect(analyser);

    // Final Outputs
    mediaStreamDestination = audioCtx.createMediaStreamDestination();
    analyser.connect(audioCtx.destination); // To speakers
    analyser.connect(mediaStreamDestination); // To recorder

    drawVisualizer();
  }
}

// --- Visualizer Logic ---
function drawVisualizer() {
  requestAnimationFrame(drawVisualizer);

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteTimeDomainData(dataArray);

  canvasCtx.fillStyle = "#050505";
  canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

  canvasCtx.lineWidth = 2;
  canvasCtx.strokeStyle = "#66fcf1"; // Neon cyan
  canvasCtx.beginPath();

  const sliceWidth = (canvas.width * 1.0) / bufferLength;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * canvas.height) / 2;

    if (i === 0) {
      canvasCtx.moveTo(x, y);
    } else {
      canvasCtx.lineTo(x, y);
    }
    x += sliceWidth;
  }

  canvasCtx.lineTo(canvas.width, canvas.height / 2);
  canvasCtx.stroke();
}

// --- Recording Logic ---
recordBtn.addEventListener("click", () => {
  initAudio();
  if (!isRecording) startRecording();
  else stopRecording();
});

function startRecording() {
  recordedChunks = [];
  const options = { mimeType: "audio/webm" };

  try {
    mediaRecorder = new MediaRecorder(mediaStreamDestination.stream, options);
  } catch (e) {
    mediaRecorder = new MediaRecorder(mediaStreamDestination.stream);
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.onstop = saveRecording;
  mediaRecorder.start();

  isRecording = true;
  recordBtn.innerText = "⏹ Stop Rec";
  recordBtn.classList.add("recording");
}

function stopRecording() {
  mediaRecorder.stop();
  isRecording = false;
  recordBtn.innerText = "⚫ Record";
  recordBtn.classList.remove("recording");
}

function saveRecording() {
  const blob = new Blob(recordedChunks, { type: "audio/webm" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  document.body.appendChild(a);
  a.style = "display: none";
  a.href = url;
  a.download = `synth_fx_recording_${new Date().getTime()}.webm`;
  a.click();
  window.URL.revokeObjectURL(url);
}

// --- Synthesizer Logic ---
function playNote(noteName, baseFreq, keyElement) {
  initAudio();
  if (activeOscillators[noteName]) return; // Prevent retrigger

  keyElement.classList.add("active");
  display.innerText = noteName;

  const pitchShift = parseInt(pitchSlider.value);
  const shiftedFreq = baseFreq * Math.pow(2, pitchShift / 12);

  const osc = audioCtx.createOscillator();
  const noteGain = audioCtx.createGain();

  osc.type = currentWaveform;
  osc.frequency.value = shiftedFreq;

  const attackTime = parseFloat(attackSlider.value);
  noteGain.gain.setValueAtTime(0, audioCtx.currentTime);
  noteGain.gain.linearRampToValueAtTime(1, audioCtx.currentTime + attackTime);

  // Connect specifically to the pre-master bus (which routes to dry & delay)
  osc.connect(noteGain);
  noteGain.connect(preMasterBus);
  osc.start();

  activeOscillators[noteName] = { osc, noteGain, keyElement };
}

function stopNote(noteName) {
  if (!activeOscillators[noteName]) return;

  const { osc, noteGain, keyElement } = activeOscillators[noteName];
  const decayTime = parseFloat(decaySlider.value);

  noteGain.gain.cancelScheduledValues(audioCtx.currentTime);
  noteGain.gain.setValueAtTime(noteGain.gain.value, audioCtx.currentTime);
  noteGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + decayTime);

  osc.stop(audioCtx.currentTime + decayTime);

  keyElement.classList.remove("active");
  if (display.innerText === noteName) display.innerText = "---";

  delete activeOscillators[noteName];
}

// --- Event Listeners ---

// 1. Piano Keys
const keys = document.querySelectorAll(".key");
keys.forEach((key) => {
  const note = key.dataset.note;
  const freq = parseFloat(key.dataset.freq);

  key.addEventListener("mousedown", () => playNote(note, freq, key));
  key.addEventListener("mouseup", () => stopNote(note));
  key.addEventListener("mouseleave", () => stopNote(note));

  key.addEventListener("touchstart", (e) => {
    e.preventDefault();
    playNote(note, freq, key);
  });
  key.addEventListener("touchend", (e) => {
    e.preventDefault();
    stopNote(note);
  });
});

// 2. Computer Keyboard
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const key = e.key.toLowerCase();
  if (keyMap[key]) {
    const domKey = document.querySelector(`[data-note="${keyMap[key]}"]`);
    if (domKey) playNote(keyMap[key], parseFloat(domKey.dataset.freq), domKey);
  }
});

window.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();
  if (keyMap[key]) stopNote(keyMap[key]);
});

// 3. UI Controls
waveBtns.forEach((btn) => {
  btn.addEventListener("click", (e) => {
    waveBtns.forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
    currentWaveform = e.target.dataset.wave;
    Object.values(activeOscillators).forEach(
      (active) => (active.osc.type = currentWaveform),
    );
  });
});

// Synth Parameters
attackSlider.addEventListener(
  "input",
  (e) => (atkVal.innerText = `${e.target.value}s`),
);
decaySlider.addEventListener(
  "input",
  (e) => (decVal.innerText = `${e.target.value}s`),
);
pitchSlider.addEventListener(
  "input",
  (e) =>
    (pitchVal.innerText =
      e.target.value > 0 ? `+${e.target.value}` : e.target.value),
);

// FX Parameters
delayTimeSlider.addEventListener("input", (e) => {
  delayTimeVal.innerText = `${e.target.value}s`;
  if (delayNode) delayNode.delayTime.value = e.target.value;
});

delayFbSlider.addEventListener("input", (e) => {
  delayFbVal.innerText = `${Math.round(e.target.value * 100)}%`;
  if (feedbackGain) feedbackGain.gain.value = e.target.value;
});

delayMixSlider.addEventListener("input", (e) => {
  delayMixVal.innerText = `${Math.round(e.target.value * 100)}%`;
  if (delayMixGain) delayMixGain.gain.value = e.target.value;
});

// Global Volume
volSlider.addEventListener("input", (e) => {
  volVal.innerText = `${Math.round(e.target.value * 100)}%`;
  if (masterGain) masterGain.gain.value = e.target.value;
});

// Draw empty visualizer line on load
canvasCtx.fillStyle = "#050505";
canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
canvasCtx.lineWidth = 2;
canvasCtx.strokeStyle = "#66fcf1";
canvasCtx.beginPath();
canvasCtx.moveTo(0, canvas.height / 2);
canvasCtx.lineTo(canvas.width, canvas.height / 2);
canvasCtx.stroke();
