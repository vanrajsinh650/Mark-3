# Mark III — Augmented Reality Iron Man Helmet System

A high-fidelity, real-time Augmented Reality (AR) face filter that overlays a detailed 3D Iron Man Mark III helmet on the user's head using a standard webcam. Powered by Three.js and MediaPipe Face Landmarker, it features advanced custom physics to deliver a realistic "fitted helmet" feel.

---

## 🚀 Key Features

*   **Premium 3D Assets:** Uses the highly detailed 97MB `iron-man_helmet_mk3.glb` model with realistic metallic textures, double-sided rendering, and custom PBR lighting.
*   **Natural Head Pivot Rotation:** 
    *   *The Problem:* Standard AR face tracking places the rotation pivot at the nose bridge. This causes the helmet to slide off the head and tilt wildly when looking up, down, or turning.
    *   *Our Solution:* Computes the head's natural neck pivot (11cm behind the face and 4.5cm below the eyes) dynamically in camera space. The helmet rotates around this neck pivot, keeping the head perfectly fitted inside the helmet cavity.
*   **Complete Head Silhouette Coverage:** Scaled to a realistic 44cm default size and shifted vertically to fully envelope the user's hair, forehead, ears, and neck profile from all angles.
*   **High-Tech Emissive Eyes:** Features glowing cyan-blue eyes with custom emissive properties that stand out realistically in varying webcam lighting environments.
*   **Adaptive Jitter Filtering:** Implements a custom **One Euro Filter** for position and rotation to deliver buttery-smooth tracking and eliminate high-frequency jitter.
*   **Interactive Control Panel:** Floating adjustment panel allowing users to fine-tune the X/Y/Z offsets, Pitch, Yaw, and Scale on the fly (fully synced with HTML controls on load).
*   **Media Capture Tools:**
    *   📸 **Snapshot:** Take high-quality screenshots overlaying the 3D model and webcam feed with mirror-correction.
    *   ⏺ **Screen Recording:** Record and export WebM video clips of the filter in action.
*   **Drag & Drop Custom Models:** Drop any external `.glb` or `.gltf` 3D model onto the browser window to instantly load and test custom face attachments.

---

## 🛠 Tech Stack

*   **Three.js (r160+)** — 3D scene engine, PBR shaders, ACES Filmic tone mapping, and directional/ambient studio lighting.
*   **MediaPipe Tasks Vision** — Real-time facial landmark detection and transformation matrix calculations running via WASM & GPU.
*   **Vite** — High-performance development server and project bundler.
*   **Vanilla CSS & HTML5 Canvas** — Clean, responsive, full-screen HUD UI.

---

## 📦 Installation & Run

1.  Install dependencies:
    ```bash
    npm install
    ```

2.  Start the development server:
    ```bash
    npm run dev
    ```

3.  Open the local address in a web browser (e.g., `http://localhost:5173` or `http://localhost:5174`).
4.  Grant camera permissions and center your face in the camera view.

---

## 📂 Project Structure

```
Mark 3/
├── index.html                    # Main entry page with webcam, WebGL canvas, and settings UI
├── package.json                  # Scripts and project dependencies
├── iron-man_helmet_mk3.glb       # 97MB High-fidelity default helmet model
├── public/                       # Static assets served by Vite
│   └── iron-man_helmet_mk3.glb
├── src/
│   ├── main.js                   # Application orchestrator, event listeners, and recorder loop
│   ├── sceneManager.js           # Three.js scene builder, loading, lighting, and pivot matrix math
│   ├── faceTracker.js            # MediaPipe initialization and WASM detection loops
│   ├── oneEuroFilter.js          # Signal processing logic for position/rotation smoothing
│   └── style.css                 # Clean, glassmorphism HUD interface styles
```

---

## ⚙ Controls Guide

| Control | Action | Purpose |
| :--- | :--- | :--- |
| 📸 **Snapshot** | Click Button | Saves a mirrored PNG capture of the combined canvas + camera feed. |
| ⏺ **Record** | Click Button | Records a video and exports it as a `.webm` file. |
| ⚙ **Sliders** | Toggle Panel | Shows/hides fine-tuning offsets. |
| **X / Y / Z Offset** | Slider Range | Moves the helmet position relative to the local orientation of your face. |
| **Pitch / Yaw** | Slider Range | Changes the tilt and side-to-side rotation of the helmet. |
| **Scale** | Slider Range | Scales the helmet larger or smaller to fit different head shapes. |
