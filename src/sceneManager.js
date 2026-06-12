/**
 * sceneManager.js
 *
 * Sets up the Three.js scene for AR helmet overlay:
 *  - WebGL renderer composited over the webcam feed
 *  - Perspective camera matched to webcam FOV
 *  - Camera-relative PBR lighting
 *  - Loads real Iron Man Mark 3 helmet GLB model
 *  - One Euro Filter for smooth face tracking
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OneEuroFilterVec } from "./oneEuroFilter.js";

// ─── Scene Manager ──────────────────────────────────────────────────────────

export class SceneManager {
  constructor(canvas) {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    this.camera.position.set(0, 0, 0);
    this.scene.add(this.camera);

    // Debug frame counter
    this._debugFrameCount = 0;

    // Lighting (attached to camera so helmet is always lit)
    this._setupLights();

    // Helmet group — everything attaches here, this gets moved by face tracking
    this.helmetRoot = new THREE.Group();
    this.helmetRoot.visible = false; // hidden until face detected
    this.scene.add(this.helmetRoot);

    // The loaded GLB model
    this.helmetModel = null;

    // One Euro Filters for position and rotation smoothing
    this.posFilter = new OneEuroFilterVec(3, 30, 0.8, 0.5, 1.0);
    this.quatFilter = new OneEuroFilterVec(4, 30, 0.5, 0.3, 1.0);

    // Offset tweaks (adjustable from UI)
    this.positionOffset = new THREE.Vector3(0, 0, 0);
    this.scaleMultiplier = 1.0;
    this.rotationOffset = new THREE.Euler(0, 0, 0);

    // GLTF loader
    this.gltfLoader = new GLTFLoader();
  }

  _setupLights() {
    // Front-right key light
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.5);
    keyLight.position.set(3, 4, 5);
    this.camera.add(keyLight);

    // Left fill light
    const fillLight = new THREE.DirectionalLight(0xaaccff, 2.0);
    fillLight.position.set(-3, 2, 3);
    this.camera.add(fillLight);

    // Bottom bounce light
    const bounceLight = new THREE.DirectionalLight(0xffaa44, 1.2);
    bounceLight.position.set(0, -4, 2);
    this.camera.add(bounceLight);

    // Top rim light
    const rimLight = new THREE.DirectionalLight(0xffffff, 1.5);
    rimLight.position.set(0, 5, -2);
    this.camera.add(rimLight);

    // Ambient hemisphere
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x222222, 1.2);
    this.scene.add(hemiLight);
  }

  /**
   * Load the Iron Man helmet GLB from the public folder.
   * Returns a promise that resolves when the model is ready.
   */
  loadHelmetModel(url = "/iron_man_helmet.glb") {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          this.helmetModel = gltf.scene;

          // Auto-center the model
          const box = new THREE.Box3().setFromObject(this.helmetModel);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());

          // Center it at origin
          this.helmetModel.position.sub(center);

          // Scale to head-size in MediaPipe metric space (~18-20cm)
          const maxDim = Math.max(size.x, size.y, size.z);
          const desiredSize = 20; // cm, roughly head-sized
          const scaleFactor = desiredSize / maxDim;
          this.helmetModel.scale.setScalar(scaleFactor);

          this.helmetRoot.add(this.helmetModel);

          console.log(
            `[MARK3] Helmet loaded: ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)}, scaled by ${scaleFactor.toFixed(3)}`
          );

          resolve();
        },
        (progress) => {
          if (progress.total) {
            const pct = Math.round((progress.loaded / progress.total) * 100);
            console.log(`[MARK3] Loading helmet: ${pct}%`);
          }
        },
        (err) => {
          console.error("[MARK3] Failed to load helmet model:", err);
          reject(err);
        }
      );
    });
  }

  /**
   * Match the Three.js camera to the webcam resolution.
   */
  updateCameraForVideo(videoWidth, videoHeight) {
    const aspect = videoWidth / videoHeight;
    this.camera.aspect = aspect;
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(videoWidth, videoHeight, false);
  }

  /**
   * Apply the 4×4 facial transformation matrix from MediaPipe.
   */
  applyFaceMatrix(matrixData, timestamp) {
    if (!matrixData) return;

    const m = new THREE.Matrix4().fromArray(matrixData);

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    m.decompose(pos, quat, scale);

    // Debug log every 60 frames
    this._debugFrameCount++;
    if (this._debugFrameCount % 60 === 1) {
      console.log(
        `[MARK3] Face pos: x=${pos.x.toFixed(2)}, y=${pos.y.toFixed(2)}, z=${pos.z.toFixed(2)}`
      );
    }

    // Validate
    if (
      isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z) ||
      isNaN(quat.x) || isNaN(quat.y) || isNaN(quat.z) || isNaN(quat.w)
    ) {
      return;
    }

    // Smooth position and rotation
    const smoothedPosArr = this.posFilter.filter([pos.x, pos.y, pos.z], timestamp);
    const smoothedPos = new THREE.Vector3().fromArray(smoothedPosArr);

    const smoothedQuatArr = this.quatFilter.filter([quat.x, quat.y, quat.z, quat.w], timestamp);
    const smoothedQuat = new THREE.Quaternion().fromArray(smoothedQuatArr).normalize();

    // Apply offsets
    smoothedPos.add(this.positionOffset);

    this.helmetRoot.position.copy(smoothedPos);
    this.helmetRoot.quaternion.copy(smoothedQuat);

    // Apply rotation offset
    const offsetQuat = new THREE.Quaternion().setFromEuler(this.rotationOffset);
    this.helmetRoot.quaternion.multiply(offsetQuat);

    this.helmetRoot.scale.setScalar(this.scaleMultiplier);
  }

  /**
   * Load a custom .glb/.gltf from a File object (drag-and-drop).
   */
  loadCustomModel(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      this.gltfLoader.load(
        url,
        (gltf) => {
          // Remove previous model
          if (this.helmetModel) {
            this.helmetRoot.remove(this.helmetModel);
          }

          this.helmetModel = gltf.scene;

          const box = new THREE.Box3().setFromObject(this.helmetModel);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const desiredSize = 20;
          const scaleFactor = desiredSize / maxDim;

          this.helmetModel.position.sub(center);
          this.helmetModel.scale.setScalar(scaleFactor);

          this.helmetRoot.add(this.helmetModel);

          URL.revokeObjectURL(url);
          resolve();
        },
        undefined,
        (err) => {
          URL.revokeObjectURL(url);
          reject(err);
        }
      );
    });
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
