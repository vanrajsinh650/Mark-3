/**
 * sceneManager.js
 *
 * AR helmet overlay with proper face hiding.
 * Uses a VISIBLE dark sphere to block the real face from showing through.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OneEuroFilterVec } from "./oneEuroFilter.js";

// ─── Face Blocker ───────────────────────────────────────────────────────────
// A VISIBLE dark sphere that sits inside the helmet and hides the real face.
// Unlike a depth-only occluder, this actually renders dark pixels that cover
// the webcam feed (which is an HTML element behind the Three.js canvas).

function createFaceBlocker() {
  const geo = new THREE.SphereGeometry(1, 32, 32);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x0a0a0a,      // Very dark — looks like helmet interior
    side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;  // Render BEFORE the helmet
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
    this.renderer.toneMappingExposure = 1.3;

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

    // Face blocker — VISIBLE dark sphere that hides the real face
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

    this.gltfLoader = new GLTFLoader();
  }

  _setupLights() {
    // Front key light
    const keyLight = new THREE.DirectionalLight(0xffffff, 4.0);
    keyLight.position.set(3, 4, 5);
    this.camera.add(keyLight);

    // Left fill
    const fillLight = new THREE.DirectionalLight(0xaaccff, 2.5);
    fillLight.position.set(-4, 2, 4);
    this.camera.add(fillLight);

    // Right fill
    const rightFill = new THREE.DirectionalLight(0xffccaa, 1.8);
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

    // Hemisphere + ambient
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x333333, 1.8);
    this.scene.add(hemiLight);

    const ambLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambLight);
  }

  /**
   * Load helmet GLB and position it properly on the face.
   */
  loadHelmetModel(url = "/iron_man_helmet.glb") {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          if (this.helmetWrapper) {
            this.helmetRoot.remove(this.helmetWrapper);
          }

          this.helmetModel = gltf.scene;

          // Make all helmet meshes render AFTER the face blocker
          this.helmetModel.traverse((child) => {
            if (child.isMesh) {
              child.renderOrder = 1;
            }
          });

          // Bounding box
          const box = new THREE.Box3().setFromObject(this.helmetModel);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());

          console.log(`[MARK3] Raw size: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`);
          console.log(`[MARK3] Raw center: ${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)}`);

          // Center at origin
          this.helmetModel.position.set(-center.x, -center.y, -center.z);

          // Scale: helmet should be ~35cm to fully enclose a human head
          const maxDim = Math.max(size.x, size.y, size.z);
          const desiredSize = 35;
          const scaleFactor = desiredSize / maxDim;

          // Wrapper for scale + offset
          const wrapper = new THREE.Group();
          wrapper.add(this.helmetModel);
          wrapper.scale.setScalar(scaleFactor);

          // Shift UP so eye slits align with face center
          const scaledHeight = size.y * scaleFactor;
          wrapper.position.set(0, scaledHeight * 0.15, 0);

          this.helmetWrapper = wrapper;
          this.helmetRoot.add(wrapper);

          // Face blocker: big enough to completely cover the face
          // Make it slightly smaller than the helmet so it sits inside
          const blockerW = size.x * scaleFactor * 0.45;
          const blockerH = size.y * scaleFactor * 0.50;
          const blockerD = size.z * scaleFactor * 0.42;
          this.faceBlocker.scale.set(blockerW, blockerH, blockerD);
          this.faceBlocker.position.set(0, scaledHeight * 0.08, 0);

          console.log(`[MARK3] Loaded. Scale: ${scaleFactor.toFixed(4)}, blocker: ${blockerW.toFixed(1)}x${blockerH.toFixed(1)}x${blockerD.toFixed(1)}`);

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
          if (this.helmetWrapper) {
            this.helmetRoot.remove(this.helmetWrapper);
          }

          this.helmetModel = gltf.scene;
          this.helmetModel.traverse((child) => {
            if (child.isMesh) child.renderOrder = 1;
          });

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
          wrapper.position.set(0, scaledHeight * 0.15, 0);

          this.helmetWrapper = wrapper;
          this.helmetRoot.add(wrapper);

          this.faceBlocker.scale.set(
            size.x * scaleFactor * 0.45,
            size.y * scaleFactor * 0.50,
            size.z * scaleFactor * 0.42
          );
          this.faceBlocker.position.set(0, scaledHeight * 0.08, 0);

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
