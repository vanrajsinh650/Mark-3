/**
 * sceneManager.js
 *
 * AR helmet overlay with proper face hiding.
 * Forces double-sided rendering on all model meshes to fix "broken" appearance.
 * Uses a large dark sphere to fully hide the real face behind the helmet.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OneEuroFilterVec } from "./oneEuroFilter.js";

// ─── Face Blocker ───────────────────────────────────────────────────────────
// A VISIBLE dark sphere that hides the real face.
// Must be large enough to cover the entire head from every angle.

function createFaceBlocker() {
  const geo = new THREE.SphereGeometry(1, 48, 48);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x080808,
    side: THREE.FrontSide,
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 0;
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

    // Face blocker — renders BEFORE helmet, hides real face
    this.faceBlocker = createFaceBlocker();
    this.helmetRoot.add(this.faceBlocker);

    this.helmetModel = null;
    this.helmetWrapper = null;

    // Filters
    this.posFilter = new OneEuroFilterVec(3, 30, 0.8, 0.5, 1.0);
    this.quatFilter = new OneEuroFilterVec(4, 30, 0.5, 0.3, 1.0);

    // Offsets (adjustable from UI)
    this.positionOffset = new THREE.Vector3(0, 0, 0);
    this.scaleMultiplier = 1.0;
    this.rotationOffset = new THREE.Euler(0, 0, 0);

    this.gltfLoader = new GLTFLoader();
  }

  _setupLights() {
    // Strong multi-directional lighting for realistic metallic look
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
   * Setup the loaded model for proper rendering:
   * - Force double-sided rendering (fixes invisible/broken faces)
   * - Set renderOrder so helmet draws ON TOP of the face blocker
   */
  _prepareModel(model) {
    model.traverse((child) => {
      if (child.isMesh) {
        // CRITICAL: Force double-sided rendering.
        // Many GLB models have faces with normals pointing only outward.
        // From certain angles, the back faces are invisible, making the
        // helmet look "broken" with holes. DoubleSide fixes this.
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => {
              mat.side = THREE.DoubleSide;
              mat.needsUpdate = true;
            });
          } else {
            child.material.side = THREE.DoubleSide;
            child.material.needsUpdate = true;
          }
        }
        // Render AFTER the face blocker
        child.renderOrder = 1;
      }
    });
  }

  /**
   * Load helmet model, center it, scale it to cover the full head,
   * and set up the face blocker.
   */
  _setupHelmet(model) {
    // Remove previous
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

    // Scale: ~38cm max dimension — slightly larger than a real head
    // to ensure full coverage from every angle
    const maxDim = Math.max(size.x, size.y, size.z);
    const desiredSize = 38;
    const scaleFactor = desiredSize / maxDim;

    // Wrapper group for scale + offset
    const wrapper = new THREE.Group();
    wrapper.add(this.helmetModel);
    wrapper.scale.setScalar(scaleFactor);

    // Shift UP so the helmet's eye slits align with the face center.
    // MediaPipe tracks the nose bridge area. The helmet's geometric center
    // is above the eye level (because of the dome). Shift up to compensate.
    const scaledHeight = size.y * scaleFactor;
    wrapper.position.set(0, scaledHeight * 0.12, 0);

    this.helmetWrapper = wrapper;
    this.helmetRoot.add(wrapper);

    // Face blocker: a LARGE dark sphere that completely covers the head.
    // It must be big enough that no skin is visible from ANY angle.
    // The helmet renders on top of it, so the blocker is only visible
    // through gaps — where it looks like the dark helmet interior.
    this.faceBlocker.scale.set(
      12,  // width: ~24cm diameter — wider than a head
      14,  // height: ~28cm diameter — taller than a head (forehead to chin)
      11   // depth: ~22cm — front to back of head
    );
    // Position the blocker centered on the face, slightly up
    this.faceBlocker.position.set(0, scaledHeight * 0.06, -1);

    console.log(`[MARK3] Loaded. Scale: ${scaleFactor.toFixed(4)}, desired: ${desiredSize}cm`);
  }

  loadHelmetModel(url = "/iron-man_helmet_mk3.glb") {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          this._setupHelmet(gltf.scene);
          resolve();
        },
        (progress) => {
          if (progress.total) {
            console.log(`[MARK3] Loading: ${Math.round((progress.loaded / progress.total) * 100)}%`);
          }
        },
        (err) => {
          console.error("[MARK3] Load failed:", err);
          reject(err);
        }
      );
    });
  }

  updateCameraForVideo(videoWidth, videoHeight) {
    this.camera.aspect = videoWidth / videoHeight;
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(videoWidth, videoHeight, false);
  }

  applyFaceMatrix(matrixData, timestamp) {
    if (!matrixData) return;

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
  }

  loadCustomModel(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      this.gltfLoader.load(
        url,
        (gltf) => {
          this._setupHelmet(gltf.scene);
          URL.revokeObjectURL(url);
          resolve();
        },
        undefined,
        (err) => { URL.revokeObjectURL(url); reject(err); }
      );
    });
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
