/**
 * sceneManager.js
 *
 * AR helmet overlay — loads real GLB model, positions it precisely
 * on the face, and uses an occluder to hide the real face.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OneEuroFilterVec } from "./oneEuroFilter.js";

// ─── Face Occluder ──────────────────────────────────────────────────────────
// Invisible mesh that blocks the real face from showing through the helmet.
// Writes to depth buffer only (no color), so anything behind it is hidden.

function createFaceOccluder() {
  // Use a box-ish ellipsoid that approximates a full head volume
  const geo = new THREE.SphereGeometry(1, 32, 32);
  const mat = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  mesh.name = "faceOccluder";
  return mesh;
}

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
    this.renderer.toneMappingExposure = 1.3;

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    this.camera.position.set(0, 0, 0);
    this.scene.add(this.camera);

    // Debug
    this._debugFrameCount = 0;

    // Lighting
    this._setupLights();

    // Helmet root — face tracking moves this entire group
    this.helmetRoot = new THREE.Group();
    this.helmetRoot.visible = false;
    this.scene.add(this.helmetRoot);

    // Face occluder
    this.occluder = createFaceOccluder();
    this.helmetRoot.add(this.occluder);

    // The loaded model
    this.helmetModel = null;
    this.helmetWrapper = null;

    // One Euro Filters for smooth tracking
    this.posFilter = new OneEuroFilterVec(3, 30, 0.8, 0.5, 1.0);
    this.quatFilter = new OneEuroFilterVec(4, 30, 0.5, 0.3, 1.0);

    // Offset tweaks from UI sliders
    this.positionOffset = new THREE.Vector3(0, 0, 0);
    this.scaleMultiplier = 1.0;
    this.rotationOffset = new THREE.Euler(0, 0, 0);

    // GLTF loader
    this.gltfLoader = new GLTFLoader();
  }

  _setupLights() {
    // Strong front key light
    const keyLight = new THREE.DirectionalLight(0xffffff, 4.0);
    keyLight.position.set(3, 4, 5);
    this.camera.add(keyLight);

    // Left fill
    const fillLight = new THREE.DirectionalLight(0xaaccff, 2.5);
    fillLight.position.set(-4, 2, 4);
    this.camera.add(fillLight);

    // Right fill
    const rightFill = new THREE.DirectionalLight(0xffccaa, 1.5);
    rightFill.position.set(4, 0, 3);
    this.camera.add(rightFill);

    // Bottom bounce
    const bounceLight = new THREE.DirectionalLight(0xffaa44, 1.5);
    bounceLight.position.set(0, -4, 2);
    this.camera.add(bounceLight);

    // Top rim
    const rimLight = new THREE.DirectionalLight(0xffffff, 2.0);
    rimLight.position.set(0, 5, -2);
    this.camera.add(rimLight);

    // Back light
    const backLight = new THREE.DirectionalLight(0x8888ff, 1.2);
    backLight.position.set(0, 2, -5);
    this.camera.add(backLight);

    // Ambient
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x333333, 1.8);
    this.scene.add(hemiLight);

    // Environment-like ambient from all sides
    const ambLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambLight);
  }

  /**
   * Load the helmet GLB model.
   *
   * The critical logic here:
   * - MediaPipe gives us the face center (roughly at nose bridge between the eyes)
   * - We need to position the helmet so its eye-slit area aligns with that point
   * - After bounding-box centering, the geometric center of the helmet is at origin
   * - But the "eye level" of a helmet is BELOW the geometric center (because the
   *   dome/top of the helmet raises the center above the eye slits)
   * - So we need to SHIFT THE MODEL UP so the eye slits align with the tracked point
   */
  loadHelmetModel(url = "/iron-man_helmet_mk3.glb") {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          // Remove previous
          if (this.helmetWrapper) {
            this.helmetRoot.remove(this.helmetWrapper);
          }

          this.helmetModel = gltf.scene;

          // Get bounding box
          const box = new THREE.Box3().setFromObject(this.helmetModel);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());

          console.log(`[MARK3] Model raw size: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`);
          console.log(`[MARK3] Model raw center: ${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)}`);

          // Center the model at origin
          this.helmetModel.position.set(-center.x, -center.y, -center.z);

          // Scale: make the helmet big enough to cover the entire head.
          // A human head is ~22cm wide, ~25cm tall. The helmet should be
          // BIGGER than that — ~35cm max dimension.
          const maxDim = Math.max(size.x, size.y, size.z);
          const desiredSize = 35; // cm — generous to fully enclose the head
          const scaleFactor = desiredSize / maxDim;

          // Create wrapper for the scaled/offset model
          const wrapper = new THREE.Group();
          wrapper.add(this.helmetModel);
          wrapper.scale.setScalar(scaleFactor);

          // KEY FIX: Shift the model UP so the eye slits align with the face center.
          // The eye slits are roughly 30-35% down from the top of the helmet.
          // After centering, the geometric center is at Y=0, but eyes are below that.
          // So we push the model UP by ~20% of its scaled height.
          const scaledHeight = size.y * scaleFactor;
          wrapper.position.set(0, scaledHeight * 0.18, 0);

          this.helmetWrapper = wrapper;
          this.helmetRoot.add(wrapper);

          // Configure the occluder to fully cover the face area.
          // Make it a large ellipsoid that sits inside the helmet.
          const occW = size.x * scaleFactor * 0.48; // slightly narrower than helmet
          const occH = size.y * scaleFactor * 0.52; // tall enough to cover forehead to chin
          const occD = size.z * scaleFactor * 0.45; // deep enough to hide the face
          this.occluder.scale.set(occW, occH, occD);
          // Position the occluder at the face center (slightly forward of helmet center)
          this.occluder.position.set(0, scaledHeight * 0.05, 0);

          console.log(`[MARK3] Helmet loaded. Scale: ${scaleFactor.toFixed(4)}, size: ${desiredSize}cm, yShift: ${(scaledHeight * 0.18).toFixed(2)}cm`);
          console.log(`[MARK3] Occluder size: ${occW.toFixed(1)} x ${occH.toFixed(1)} x ${occD.toFixed(1)}`);

          resolve();
        },
        (progress) => {
          if (progress.total) {
            const pct = Math.round((progress.loaded / progress.total) * 100);
            console.log(`[MARK3] Loading helmet: ${pct}%`);
          }
        },
        (err) => {
          console.error("[MARK3] Failed to load helmet:", err);
          reject(err);
        }
      );
    });
  }

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

    // Debug
    this._debugFrameCount++;
    if (this._debugFrameCount % 60 === 1) {
      console.log(`[MARK3] Face pos: x=${pos.x.toFixed(2)}, y=${pos.y.toFixed(2)}, z=${pos.z.toFixed(2)}`);
    }

    // Validate
    if (
      isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z) ||
      isNaN(quat.x) || isNaN(quat.y) || isNaN(quat.z) || isNaN(quat.w)
    ) {
      return;
    }

    // Smooth
    const smoothedPosArr = this.posFilter.filter([pos.x, pos.y, pos.z], timestamp);
    const smoothedPos = new THREE.Vector3().fromArray(smoothedPosArr);

    const smoothedQuatArr = this.quatFilter.filter([quat.x, quat.y, quat.z, quat.w], timestamp);
    const smoothedQuat = new THREE.Quaternion().fromArray(smoothedQuatArr).normalize();

    // Apply user offsets
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
          if (this.helmetWrapper) {
            this.helmetRoot.remove(this.helmetWrapper);
          }

          this.helmetModel = gltf.scene;

          const box = new THREE.Box3().setFromObject(this.helmetModel);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const desiredSize = 35;
          const scaleFactor = desiredSize / maxDim;

          this.helmetModel.position.set(-center.x, -center.y, -center.z);

          const wrapper = new THREE.Group();
          wrapper.add(this.helmetModel);
          wrapper.scale.setScalar(scaleFactor);

          const scaledHeight = size.y * scaleFactor;
          wrapper.position.set(0, scaledHeight * 0.18, 0);

          this.helmetWrapper = wrapper;
          this.helmetRoot.add(wrapper);

          // Occluder
          this.occluder.scale.set(
            size.x * scaleFactor * 0.48,
            size.y * scaleFactor * 0.52,
            size.z * scaleFactor * 0.45
          );
          this.occluder.position.set(0, scaledHeight * 0.05, 0);

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
