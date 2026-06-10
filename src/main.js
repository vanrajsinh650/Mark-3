/**
 * main.js
 *
 * Orchestrates the entire AR helmet pipeline:
 *  1. Show loading screen
 *  2. Initialise FaceTracker (MediaPipe WASM + webcam)
 *  3. Initialise SceneManager (Three.js scene)
 *  4. Per-frame: get face matrix → smooth with One Euro Filter → apply to helmet → render
 *  5. Wire up HUD controls
 */

import "./style.css";
import { FaceTracker } from "./faceTracker.js";
import { SceneManager } from "./sceneManager.js";
import { OneEuroFilterVec } from "./oneEuroFilter.js";

// ─── DOM refs ────────────────────────────────────────────────────────────────
const loadingScreen = document.getElementById("loading-screen");
const loadingBar = document.getElementById("loading-bar");
const hud = document.getElementById("hud");
const webcamEl = document.getElementById("webcam");
const canvasEl = document.getElementById("three-canvas");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const fpsDisplay = document.getElementById("fps-display");
const faceStatus = document.getElementById("face-status");

// Buttons
const btnSnapshot = document.getElementById("btn-snapshot");
const btnRecord = document.getElementById("btn-record");
const btnSliders = document.getElementById("btn-sliders");
const btnResetModel = document.getElementById("btn-reset-model");
const sliderPanel = document.getElementById("slider-panel");

// Sliders
const offsetX = document.getElementById("offset-x");
const offsetY = document.getElementById("offset-y");
const offsetZ = document.getElementById("offset-z");
const helmetScale = document.getElementById("helmet-scale");

// Finish swatches
const finishSwatches = document.querySelectorAll(".finish-swatch");

// Drop zone
const dropZone = document.getElementById("drop-zone");

// ─── Globals ─────────────────────────────────────────────────────────────────
let tracker, scene;
let cameraReady = false;
let lastFrameTime = performance.now();
let frameCount = 0;
let fps = 0;

// One Euro Filters for position (3) and quaternion (4)
// Tuned for face tracking: low minCutoff = very smooth at rest, moderate beta = responsive on fast moves
const posFilter = new OneEuroFilterVec(3, 30, 0.8, 0.5, 1.0);
const quatFilter = new OneEuroFilterVec(4, 30, 0.5, 0.3, 1.0);

// Recording state
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

// ─── Loading progress ────────────────────────────────────────────────────────
function setLoading(pct) {
  loadingBar.style.width = pct + "%";
}

// ─── Initialise ──────────────────────────────────────────────────────────────
async function init() {
  setLoading(10);

  // 1. Create SceneManager
  scene = new SceneManager(canvasEl);
  setLoading(30);

  // 2. Create & init FaceTracker
  tracker = new FaceTracker();

  statusText.textContent = "LOADING AI MODEL...";
  await tracker.init();
  setLoading(60);

  // 3. Start webcam
  statusText.textContent = "REQUESTING CAMERA...";
  try {
    await tracker.start(webcamEl);
    cameraReady = true;
    statusDot.classList.add("active");
    statusText.textContent = "SYSTEM ONLINE";
    setLoading(90);
  } catch (err) {
    statusText.textContent = "CAMERA ACCESS DENIED";
    console.error("Camera error:", err);
    return;
  }

  // 4. Match Three.js camera to webcam dimensions
  scene.updateCameraForVideo(webcamEl.videoWidth, webcamEl.videoHeight);

  // 5. Hook up face result callback
  tracker.onResult = onFaceResult;

  // 6. Start render loop
  renderLoop();

  // 7. Reveal HUD, hide loading
  setLoading(100);
  setTimeout(() => {
    loadingScreen.classList.add("hidden");
    hud.classList.add("visible");
  }, 400);
}

// ─── Face result callback ────────────────────────────────────────────────────
function onFaceResult(results, videoWidth, videoHeight) {
  // Update canvas size if video dimensions changed
  if (canvasEl.width !== videoWidth || canvasEl.height !== videoHeight) {
    scene.updateCameraForVideo(videoWidth, videoHeight);
  }

  if (
    results.facialTransformationMatrixes &&
    results.facialTransformationMatrixes.length > 0
  ) {
    faceStatus.textContent = "FACE: LOCKED";

    const matData = results.facialTransformationMatrixes[0].data;
    const timestamp = performance.now() / 1000;

    // Decompose the raw matrix
    const rawMatrix = new Float32Array(matData);

    // Extract position (translation column)
    const rawPos = [rawMatrix[12], rawMatrix[13], rawMatrix[14]];

    // Extract quaternion from rotation part of matrix
    // We'll use a simplified extraction
    const te = rawMatrix;
    const m11 = te[0], m12 = te[4], m13 = te[8];
    const m21 = te[1], m22 = te[5], m23 = te[9];
    const m31 = te[2], m32 = te[6], m33 = te[10];
    const trace = m11 + m22 + m33;

    let qx, qy, qz, qw;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1.0);
      qw = 0.25 / s;
      qx = (m32 - m23) * s;
      qy = (m13 - m31) * s;
      qz = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
      qw = (m32 - m23) / s;
      qx = 0.25 * s;
      qy = (m12 + m21) / s;
      qz = (m13 + m31) / s;
    } else if (m22 > m33) {
      const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
      qw = (m13 - m31) / s;
      qx = (m12 + m21) / s;
      qy = 0.25 * s;
      qz = (m23 + m32) / s;
    } else {
      const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
      qw = (m21 - m12) / s;
      qx = (m13 + m31) / s;
      qy = (m23 + m32) / s;
      qz = 0.25 * s;
    }

    // Smooth with One Euro Filter
    const smoothedPos = posFilter.filter(rawPos, timestamp);
    const smoothedQuat = quatFilter.filter([qx, qy, qz, qw], timestamp);

    // Normalize quaternion after filtering
    const ql = Math.sqrt(
      smoothedQuat[0] ** 2 +
      smoothedQuat[1] ** 2 +
      smoothedQuat[2] ** 2 +
      smoothedQuat[3] ** 2
    );
    if (ql > 0) {
      smoothedQuat[0] /= ql;
      smoothedQuat[1] /= ql;
      smoothedQuat[2] /= ql;
      smoothedQuat[3] /= ql;
    }

    // Rebuild the smoothed matrix
    const sx = smoothedQuat[0], sy = smoothedQuat[1], sz = smoothedQuat[2], sw = smoothedQuat[3];
    const xx = sx * sx, yy = sy * sy, zz = sz * sz;
    const xy = sx * sy, xz = sx * sz, yz = sy * sz;
    const wx = sw * sx, wy = sw * sy, wz = sw * sz;

    const smoothedMatrix = [
      1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0,
      2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0,
      2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0,
      smoothedPos[0], smoothedPos[1], smoothedPos[2], 1,
    ];

    scene.applyFaceMatrix(smoothedMatrix);
    scene.helmetRoot.visible = true;
  } else {
    faceStatus.textContent = "FACE: SEARCHING...";
    scene.helmetRoot.visible = false;
  }
}

// ─── Render loop ─────────────────────────────────────────────────────────────
function renderLoop() {
  scene.render();

  // FPS counter
  frameCount++;
  const now = performance.now();
  if (now - lastFrameTime >= 1000) {
    fps = frameCount;
    frameCount = 0;
    lastFrameTime = now;
    fpsDisplay.textContent = `FPS: ${fps}`;
  }

  requestAnimationFrame(renderLoop);
}

// ─── HUD Controls ────────────────────────────────────────────────────────────

// Snapshot
btnSnapshot.addEventListener("click", () => {
  // Composite webcam + three.js overlay
  const compositeCanvas = document.createElement("canvas");
  compositeCanvas.width = webcamEl.videoWidth;
  compositeCanvas.height = webcamEl.videoHeight;
  const ctx = compositeCanvas.getContext("2d");

  // Draw mirrored webcam
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(webcamEl, -compositeCanvas.width, 0, compositeCanvas.width, compositeCanvas.height);
  ctx.restore();

  // Draw three.js canvas on top (also mirrored already via CSS, so draw mirrored)
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(canvasEl, -compositeCanvas.width, 0, compositeCanvas.width, compositeCanvas.height);
  ctx.restore();

  // Download
  const link = document.createElement("a");
  link.download = `mark3_${Date.now()}.png`;
  link.href = compositeCanvas.toDataURL("image/png");
  link.click();

  // Flash effect
  btnSnapshot.classList.add("active");
  setTimeout(() => btnSnapshot.classList.remove("active"), 300);
});

// Record
const recIndicator = document.getElementById("rec-indicator");

btnRecord.addEventListener("click", () => {
  if (!isRecording) {
    startRecording();
  } else {
    stopRecording();
  }
});

function startRecording() {
  // Create a composite canvas stream
  const compositeCanvas = document.createElement("canvas");
  compositeCanvas.width = webcamEl.videoWidth;
  compositeCanvas.height = webcamEl.videoHeight;
  const ctx = compositeCanvas.getContext("2d");

  const drawFrame = () => {
    if (!isRecording) return;
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(webcamEl, -compositeCanvas.width, 0, compositeCanvas.width, compositeCanvas.height);
    ctx.restore();
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(canvasEl, -compositeCanvas.width, 0, compositeCanvas.width, compositeCanvas.height);
    ctx.restore();
    requestAnimationFrame(drawFrame);
  };

  const stream = compositeCanvas.captureStream(30);
  mediaRecorder = new MediaRecorder(stream, {
    mimeType: "video/webm;codecs=vp9",
  });

  recordedChunks = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `mark3_${Date.now()}.webm`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  isRecording = true;
  mediaRecorder.start();
  drawFrame();
  btnRecord.classList.add("active");
  recIndicator.classList.add("active");
}

function stopRecording() {
  isRecording = false;
  mediaRecorder.stop();
  btnRecord.classList.remove("active");
  recIndicator.classList.remove("active");
}

// Slider toggle
btnSliders.addEventListener("click", () => {
  sliderPanel.classList.toggle("visible");
  btnSliders.classList.toggle("active");
});

// Slider values
offsetX.addEventListener("input", () => {
  scene.positionOffset.x = parseFloat(offsetX.value);
});
offsetY.addEventListener("input", () => {
  scene.positionOffset.y = parseFloat(offsetY.value);
});
offsetZ.addEventListener("input", () => {
  scene.positionOffset.z = parseFloat(offsetZ.value);
});
helmetScale.addEventListener("input", () => {
  scene.scaleMultiplier = parseFloat(helmetScale.value);
});

// Reset model
btnResetModel.addEventListener("click", () => {
  scene.useProceduralHelmet();
  // Reset filters
  posFilter.reset();
  quatFilter.reset();
});

// Finish presets
finishSwatches.forEach((swatch) => {
  swatch.addEventListener("click", () => {
    finishSwatches.forEach((s) => s.classList.remove("active"));
    swatch.classList.add("active");
    scene.setFinishPreset(swatch.dataset.finish);
  });
});

// ─── Drag & Drop custom model ────────────────────────────────────────────────
document.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("visible");
});

document.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null) {
    dropZone.classList.remove("visible");
  }
});

document.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropZone.classList.remove("visible");

  const files = e.dataTransfer.files;
  if (files.length === 0) return;

  const file = files[0];
  const name = file.name.toLowerCase();
  if (!name.endsWith(".glb") && !name.endsWith(".gltf")) {
    alert("Please drop a .glb or .gltf file");
    return;
  }

  statusText.textContent = "LOADING MODEL...";
  try {
    await scene.loadCustomModel(file);
    statusText.textContent = "CUSTOM MODEL LOADED";
    setTimeout(() => {
      statusText.textContent = "SYSTEM ONLINE";
    }, 2000);
  } catch (err) {
    statusText.textContent = "MODEL LOAD FAILED";
    console.error("Model load error:", err);
  }
});

// ─── Handle window resize ────────────────────────────────────────────────────
window.addEventListener("resize", () => {
  if (cameraReady) {
    scene.updateCameraForVideo(webcamEl.videoWidth, webcamEl.videoHeight);
  }
});

// ─── Boot ────────────────────────────────────────────────────────────────────
init().catch((err) => {
  console.error("Initialisation failed:", err);
  statusText.textContent = "INIT FAILED";
});
