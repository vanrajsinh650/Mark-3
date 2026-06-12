/**
 * main.js
 *
 * Clean AR helmet pipeline:
 *  1. Load GLB helmet model
 *  2. Start webcam + face tracking
 *  3. Per-frame: face matrix → helmet position → render
 *  4. Minimal controls: snapshot, record, sliders
 */

import "./style.css";
import { FaceTracker } from "./faceTracker.js";
import { SceneManager } from "./sceneManager.js";

// ─── DOM refs ────────────────────────────────────────────────────────────────
const loadingScreen = document.getElementById("loading-screen");
const loadingBar = document.getElementById("loading-bar");
const webcamEl = document.getElementById("webcam");
const canvasEl = document.getElementById("three-canvas");

const btnSnapshot = document.getElementById("btn-snapshot");
const btnRecord = document.getElementById("btn-record");
const btnSliders = document.getElementById("btn-sliders");
const sliderPanel = document.getElementById("slider-panel");
const recIndicator = document.getElementById("rec-indicator");
const dropZone = document.getElementById("drop-zone");

const offsetX = document.getElementById("offset-x");
const offsetY = document.getElementById("offset-y");
const offsetZ = document.getElementById("offset-z");
const rotateX = document.getElementById("rotate-x");
const rotateY = document.getElementById("rotate-y");
const helmetScale = document.getElementById("helmet-scale");

// ─── Globals ─────────────────────────────────────────────────────────────────
let tracker, scene;
let cameraReady = false;

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
  setLoading(20);

  // 2. Load the real GLB helmet model
  try {
    await scene.loadHelmetModel("/iron_man_helmet.glb");
    console.log("[MARK3] Helmet model loaded successfully");
    setLoading(50);
  } catch (err) {
    console.error("[MARK3] Failed to load helmet:", err);
  }

  // 3. Create & init FaceTracker
  tracker = new FaceTracker();
  await tracker.init();
  setLoading(70);

  // 4. Start webcam
  try {
    await tracker.start(webcamEl);
    cameraReady = true;
    setLoading(90);
  } catch (err) {
    console.error("Camera error:", err);
    return;
  }

  // 5. Match Three.js camera to webcam
  if (webcamEl.videoWidth && webcamEl.videoHeight) {
    scene.updateCameraForVideo(webcamEl.videoWidth, webcamEl.videoHeight);
  }

  // 6. Hook up face result callback
  tracker.onResult = onFaceResult;

  // 7. Start render loop
  renderLoop();

  // 8. Hide loading screen
  setLoading(100);
  setTimeout(() => {
    loadingScreen.classList.add("hidden");
  }, 400);
}

// ─── Face result callback ────────────────────────────────────────────────────
function onFaceResult(results, videoWidth, videoHeight) {
  try {
    if (!videoWidth || !videoHeight) return;

    // Update canvas size if video dimensions changed
    if (canvasEl.width !== videoWidth || canvasEl.height !== videoHeight) {
      scene.updateCameraForVideo(videoWidth, videoHeight);
    }

    if (
      results.facialTransformationMatrixes &&
      results.facialTransformationMatrixes.length > 0
    ) {
      const matData = results.facialTransformationMatrixes[0].data;
      const timestamp = performance.now() / 1000;

      scene.applyFaceMatrix(matData, timestamp);
      scene.helmetRoot.visible = true;
    } else {
      scene.helmetRoot.visible = false;
    }
  } catch (err) {
    console.error("Error in onFaceResult:", err);
  }
}

// ─── Render loop ─────────────────────────────────────────────────────────────
function renderLoop() {
  try {
    scene.render();
  } catch (err) {
    console.error("Render loop error:", err);
  }
  requestAnimationFrame(renderLoop);
}

// ─── Controls ────────────────────────────────────────────────────────────────

// Snapshot
btnSnapshot.addEventListener("click", () => {
  const compositeCanvas = document.createElement("canvas");
  compositeCanvas.width = webcamEl.videoWidth;
  compositeCanvas.height = webcamEl.videoHeight;
  const ctx = compositeCanvas.getContext("2d");

  // Draw mirrored webcam
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(webcamEl, -compositeCanvas.width, 0, compositeCanvas.width, compositeCanvas.height);
  ctx.restore();

  // Draw Three.js canvas (mirrored)
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(canvasEl, -compositeCanvas.width, 0, compositeCanvas.width, compositeCanvas.height);
  ctx.restore();

  // Download
  const link = document.createElement("a");
  link.download = `mark3_${Date.now()}.png`;
  link.href = compositeCanvas.toDataURL("image/png");
  link.click();

  btnSnapshot.classList.add("active");
  setTimeout(() => btnSnapshot.classList.remove("active"), 300);
});

// Record
btnRecord.addEventListener("click", () => {
  if (!isRecording) {
    startRecording();
  } else {
    stopRecording();
  }
});

function startRecording() {
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
rotateX.addEventListener("input", () => {
  scene.rotationOffset.x = (parseFloat(rotateX.value) * Math.PI) / 180;
});
rotateY.addEventListener("input", () => {
  scene.rotationOffset.y = (parseFloat(rotateY.value) * Math.PI) / 180;
});
helmetScale.addEventListener("input", () => {
  scene.scaleMultiplier = parseFloat(helmetScale.value);
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

  try {
    await scene.loadCustomModel(file);
    console.log("[MARK3] Custom model loaded");
  } catch (err) {
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
});
