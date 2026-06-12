/**
 * sceneManager.js
 *
 * AR helmet overlay:
 * - Face blocker sphere uses depthWrite:false so helmet always renders on top
 * - Helmet persists when face is briefly lost (hand blocking etc.)
 * - DoubleSide rendering fixes broken model faces
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OneEuroFilterVec } from "./oneEuroFilter.js";

// ─── Face Blocker ───────────────────────────────────────────────────────────
// Fills the face area with helmet-matching color to hide the webcam feed.
// depthWrite: false = the helmet ALWAYS renders on top of this sphere,
// regardless of position. The blocker ONLY blocks the webcam video behind it.

function createFaceBlocker() {
  const geo = new THREE.SphereGeometry(1, 48, 48);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x6b1515,       // Dark metallic red — matches helmet
    metalness: 0.7,
    roughness: 0.35,
    side: THREE.FrontSide,
    depthWrite: false,      // CRITICAL: never block helmet parts
    depthTest: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;   // Render FIRST, before helmet
  mesh.name = "faceBlocker";
  return mesh;
}

// ─── Scene Manager ──────────────────────────────────────────────────────────

export class SceneManager {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    this.camera.position.set(0, 0, 0);
    this.scene.add(this.camera);

    this._debugFrameCount = 0;
    this._setupLights();

    // Helmet root — face tracking moves this
    this.helmetRoot = new THREE.Group();
    this.helmetRoot.visible = false;
    this.scene.add(this.helmetRoot);

    // Face blocker
    this.faceBlocker = createFaceBlocker();
    this.helmetRoot.add(this.faceBlocker);

    this.helmetModel = null;
    this.helmetWrapper = null;

    // Filters
    this.posFilter = new OneEuroFilterVec(3, 30, 0.8, 0.5, 1.0);
    this.quatFilter = new OneEuroFilterVec(4, 30, 0.5, 0.3, 1.0);

    // Offsets
    this.positionOffset = new THREE.Vector3(0, 0, 0);
    this.scaleMultiplier = 1.0;
    this.rotationOffset = new THREE.Euler(0, 0, 0);

    // Persistence: keep helmet visible when face tracking is briefly lost
    this._faceDetected = false;
    this._lastFaceTime = 0;
    this._persistMs = 1500; // Keep helmet visible for 1.5s after losing face

    this.gltfLoader = new GLTFLoader();
  }

  _setupLights() {
    const keyLight = new THREE.DirectionalLight(0xffffff, 4.5);
    keyLight.position.set(3, 4, 5);
    this.camera.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xaaccff, 2.5);
    fillLight.position.set(-4, 2, 4);
    this.camera.add(fillLight);

    const rightFill = new THREE.DirectionalLight(0xffccaa, 2.0);
    rightFill.position.set(4, 0, 3);
    this.camera.add(rightFill);

    const bounceLight = new THREE.DirectionalLight(0xffaa44, 1.5);
    bounceLight.position.set(0, -4, 2);
    this.camera.add(bounceLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 2.0);
    rimLight.position.set(0, 5, -2);
    this.camera.add(rimLight);

    const backLight = new THREE.DirectionalLight(0x8888ff, 1.2);
    backLight.position.set(0, 2, -5);
    this.camera.add(backLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x333333, 2.0);
    this.scene.add(hemiLight);

    const ambLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambLight);
  }

  /**
   * Force double-sided rendering + correct render order on all model meshes
   */
  _prepareModel(model) {
    model.traverse((child) => {
      if (child.isMesh) {
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((mat) => {
            mat.side = THREE.DoubleSide;
            mat.depthWrite = true;
            mat.needsUpdate = true;
          });
        }
        child.renderOrder = 1; // Render AFTER face blocker
      }
    });
  }

  /**
   * Set up the loaded helmet model
   */
  _setupHelmet(model) {
    if (this.helmetWrapper) {
      this.helmetRoot.remove(this.helmetWrapper);
    }

    this.helmetModel = model;
    this._prepareModel(this.helmetModel);

    // Bounding box
    const box = new THREE.Box3().setFromObject(this.helmetModel);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    console.log(`[MARK3] Raw size: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`);

    // Center at origin
    this.helmetModel.position.set(-center.x, -center.y, -center.z);

    // Scale to ~38cm to fully cover head
    const maxDim = Math.max(size.x, size.y, size.z);
    const desiredSize = 38;
    const scaleFactor = desiredSize / maxDim;

    const wrapper = new THREE.Group();
    wrapper.add(this.helmetModel);
    wrapper.scale.setScalar(scaleFactor);

    // Shift up so eye slits align with face center
    const scaledHeight = size.y * scaleFactor;
    wrapper.position.set(0, scaledHeight * 0.12, 0);

    this.helmetWrapper = wrapper;
    this.helmetRoot.add(wrapper);

    // Face blocker: fits inside the helmet, big enough to cover entire face.
    // Since depthWrite is false, the helmet always shows on top of it.
    const bw = size.x * scaleFactor * 0.46;
    const bh = size.y * scaleFactor * 0.50;
    const bd = size.z * scaleFactor * 0.44;
    this.faceBlocker.scale.set(bw, bh, bd);
    this.faceBlocker.position.set(0, scaledHeight * 0.06, 0);

    console.log(`[MARK3] Loaded. Scale: ${scaleFactor.toFixed(4)}`);
  }

  loadHelmetModel(url = "/iron-man_helmet_mk3.glb") {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => { this._setupHelmet(gltf.scene); resolve(); },
        (progress) => {
          if (progress.total) console.log(`[MARK3] Loading: ${Math.round((progress.loaded / progress.total) * 100)}%`);
        },
        (err) => { console.error("[MARK3] Load failed:", err); reject(err); }
      );
    });
  }

  updateCameraForVideo(videoWidth, videoHeight) {
    this.camera.aspect = videoWidth / videoHeight;
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(videoWidth, videoHeight, false);
  }

  /**
   * Called when face IS detected — apply the matrix
   */
  applyFaceMatrix(matrixData, timestamp) {
    if (!matrixData) return;

    this._faceDetected = true;
    this._lastFaceTime = performance.now();

    const m = new THREE.Matrix4().fromArray(matrixData);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    m.decompose(pos, quat, scale);

    this._debugFrameCount++;
    if (this._debugFrameCount % 60 === 1) {
      console.log(`[MARK3] Face: x=${pos.x.toFixed(2)}, y=${pos.y.toFixed(2)}, z=${pos.z.toFixed(2)}`);
    }

    if (
      isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z) ||
      isNaN(quat.x) || isNaN(quat.y) || isNaN(quat.z) || isNaN(quat.w)
    ) return;

    const sp = new THREE.Vector3().fromArray(
      this.posFilter.filter([pos.x, pos.y, pos.z], timestamp)
    );
    const sq = new THREE.Quaternion().fromArray(
      this.quatFilter.filter([quat.x, quat.y, quat.z, quat.w], timestamp)
    ).normalize();

    sp.add(this.positionOffset);

    this.helmetRoot.position.copy(sp);
    this.helmetRoot.quaternion.copy(sq);

    const offsetQuat = new THREE.Quaternion().setFromEuler(this.rotationOffset);
    this.helmetRoot.quaternion.multiply(offsetQuat);

    this.helmetRoot.scale.setScalar(this.scaleMultiplier);
    this.helmetRoot.visible = true;
  }

  /**
   * Called when face is NOT detected — keep helmet visible for a while
   * so it doesn't disappear when a hand briefly blocks the face.
   */
  onFaceLost() {
    this._faceDetected = false;
    const elapsed = performance.now() - this._lastFaceTime;
    if (elapsed > this._persistMs) {
      this.helmetRoot.visible = false;
    }
    // Otherwise keep visible at last known position
  }

  loadCustomModel(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      this.gltfLoader.load(
        url,
        (gltf) => { this._setupHelmet(gltf.scene); URL.revokeObjectURL(url); resolve(); },
        undefined,
        (err) => { URL.revokeObjectURL(url); reject(err); }
      );
    });
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
