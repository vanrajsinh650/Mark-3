/**
 * sceneManager.js
 *
 * AR helmet overlay with real GLB model:
 *  - WebGL renderer composited over the webcam feed
 *  - Loads real Iron Man Mark 3 helmet GLB
 *  - Face occluder mesh to hide the real face behind the helmet
 *  - One Euro Filter for smooth face tracking
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OneEuroFilterVec } from "./oneEuroFilter.js";

// ─── Face Occluder ──────────────────────────────────────────────────────────
// An invisible mesh shaped like a head that writes to the depth buffer
// but not the color buffer. This hides the real face behind the helmet.

function createFaceOccluder() {
  // Ellipsoid approximating a human head
  const geo = new THREE.SphereGeometry(1, 32, 32);
  const mat = new THREE.MeshBasicMaterial({
    colorWrite: false,   // Don't draw any color pixels
    depthWrite: true,     // But DO write to depth buffer — blocks anything behind it
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1; // Render BEFORE the helmet
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

    // Helmet group — face tracking moves this
    this.helmetRoot = new THREE.Group();
    this.helmetRoot.visible = false;
    this.scene.add(this.helmetRoot);

    // Face occluder — hides the real face
    this.occluder = createFaceOccluder();
    this.helmetRoot.add(this.occluder);

    // The loaded GLB model
    this.helmetModel = null;

    // One Euro Filters
    this.posFilter = new OneEuroFilterVec(3, 30, 0.8, 0.5, 1.0);
    this.quatFilter = new OneEuroFilterVec(4, 30, 0.5, 0.3, 1.0);

    // Offset tweaks
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
    const fillLight = new THREE.DirectionalLight(0xaaccff, 2.2);
    fillLight.position.set(-3, 2, 3);
    this.camera.add(fillLight);

    // Bottom bounce
    const bounceLight = new THREE.DirectionalLight(0xffaa44, 1.5);
    bounceLight.position.set(0, -4, 2);
    this.camera.add(bounceLight);

    // Top rim
    const rimLight = new THREE.DirectionalLight(0xffffff, 2.0);
    rimLight.position.set(0, 5, -2);
    this.camera.add(rimLight);

    // Back light for edge definition
    const backLight = new THREE.DirectionalLight(0x8888ff, 1.0);
    backLight.position.set(0, 2, -5);
    this.camera.add(backLight);

    // Ambient
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x222222, 1.5);
    this.scene.add(hemiLight);
  }

  /**
   * Load the Iron Man helmet GLB.
   * After loading, auto-centers and scales it to cover a full face.
   */
  loadHelmetModel(url = "/iron-man_helmet_mk3.glb") {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          // Remove any previous model
          if (this.helmetModel) {
            this.helmetRoot.remove(this.helmetModel);
          }

          this.helmetModel = gltf.scene;

          // Compute bounding box to center and scale
          const box = new THREE.Box3().setFromObject(this.helmetModel);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());

          console.log(
            `[MARK3] Model raw size: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`
          );
          console.log(
            `[MARK3] Model raw center: ${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)}`
          );

          // Center the model at origin
          this.helmetModel.position.set(-center.x, -center.y, -center.z);

          // Scale to cover the full face in MediaPipe metric space.
          // MediaPipe face mesh is roughly 15-18cm wide, 20-24cm tall.
          // We want the helmet to be bigger than the face — ~28cm across.
          const maxDim = Math.max(size.x, size.y, size.z);
          const desiredSize = 28; // cm — large enough to fully cover the face
          const scaleFactor = desiredSize / maxDim;

          // Create a wrapper group so we can offset after centering
          const wrapper = new THREE.Group();
          wrapper.add(this.helmetModel);
          wrapper.scale.setScalar(scaleFactor);

          this.helmetWrapper = wrapper;
          this.helmetRoot.add(wrapper);

          // Position the occluder to match the helmet interior
          // Ellipsoid slightly smaller than the helmet, centered on the face
          this.occluder.scale.set(
            size.x * scaleFactor * 0.42,  // width
            size.y * scaleFactor * 0.45,  // height
            size.z * scaleFactor * 0.40   // depth
          );
          this.occluder.position.set(0, 0, 0);

          console.log(
            `[MARK3] Helmet loaded. Scale factor: ${scaleFactor.toFixed(4)}, desired: ${desiredSize}cm`
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

    // Debug log
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
          if (this.helmetModel) {
            this.helmetRoot.remove(this.helmetWrapper || this.helmetModel);
          }

          this.helmetModel = gltf.scene;

          const box = new THREE.Box3().setFromObject(this.helmetModel);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const desiredSize = 28;
          const scaleFactor = desiredSize / maxDim;

          this.helmetModel.position.set(-center.x, -center.y, -center.z);

          const wrapper = new THREE.Group();
          wrapper.add(this.helmetModel);
          wrapper.scale.setScalar(scaleFactor);

          this.helmetWrapper = wrapper;
          this.helmetRoot.add(wrapper);

          // Update occluder
          this.occluder.scale.set(
            size.x * scaleFactor * 0.42,
            size.y * scaleFactor * 0.45,
            size.z * scaleFactor * 0.40
          );

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
