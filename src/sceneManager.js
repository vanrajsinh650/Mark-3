/**
 * sceneManager.js
 *
 * AR faceplate overlay — GOLD parts only:
 * - Scans all meshes in the GLB, keeps only gold/yellow ones
 * - Hides everything else (red, dark, grey parts)
 * - Faceplate is sized & positioned to stick flat on the front of the face
 * - Persists when face is briefly lost (hand blocking etc.)
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OneEuroFilterVec } from "./oneEuroFilter.js";

// ─── Colour detection helpers ───────────────────────────────────────────────

/**
 * Check if a material's base color is gold/yellow-ish.
 * We look at the RGB channels — gold has high R, medium-high G, low B.
 */
function isGoldMaterial(mat) {
  if (!mat || !mat.color) return false;
  const r = mat.color.r;
  const g = mat.color.g;
  const b = mat.color.b;

  // Gold/yellow detection:
  // High red (>0.4), decent green (>0.2), low blue (<0.35)
  // OR check if it has a metallic gold texture/map
  const isGold = (r > 0.4 && g > 0.15 && b < 0.35 && r > b * 1.5);
  // Also catch bright yellow: high R, high G, low B
  const isYellow = (r > 0.5 && g > 0.4 && b < 0.3);
  // Catch orange-gold
  const isOrangeGold = (r > 0.5 && g > 0.1 && g < 0.6 && b < 0.15);

  return isGold || isYellow || isOrangeGold;
}

/**
 * Check if any material on a mesh is gold/yellow
 */
function meshHasGoldMaterial(mesh) {
  if (!mesh.material) return false;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return mats.some(isGoldMaterial);
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

    this.helmetModel = null;
    this.helmetWrapper = null;

    // Filters
    this.posFilter = new OneEuroFilterVec(3, 30, 0.8, 0.5, 1.0);
    this.quatFilter = new OneEuroFilterVec(4, 30, 0.5, 0.3, 1.0);

    // Offsets
    this.positionOffset = new THREE.Vector3(0, 0, 0);
    this.scaleMultiplier = 1.0;
    this.rotationOffset = new THREE.Euler(0, 0, 0);

    // Persistence: keep faceplate visible when face tracking is briefly lost
    this._faceDetected = false;
    this._lastFaceTime = 0;
    this._persistMs = 1500;

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
   * Scan all meshes: keep ONLY gold/yellow parts, hide everything else.
   * Log detailed info about every mesh for debugging.
   */
  _prepareModel(model) {
    console.log("=== GLB HELMET PARTS — FULL SCAN ===");
    const goldParts = [];
    const hiddenParts = [];

    model.traverse((child) => {
      if (child.isMesh) {
        const mats = Array.isArray(child.material)
          ? child.material
          : [child.material];

        // Get colour info for logging
        const colorInfo = mats.map((m) => {
          if (m && m.color) {
            return `rgb(${(m.color.r * 255).toFixed(0)},${(m.color.g * 255).toFixed(0)},${(m.color.b * 255).toFixed(0)}) hex=#${m.color.getHexString()}`;
          }
          return "no-color";
        }).join(" | ");

        const isGold = meshHasGoldMaterial(child);

        if (isGold) {
          // KEEP this mesh
          goldParts.push(child.name || "unnamed");
          console.log(`✅ KEEP  "${child.name}" — ${colorInfo}`);

          mats.forEach((mat) => {
            mat.side = THREE.DoubleSide;
            mat.depthWrite = true;
            mat.needsUpdate = true;
          });
          child.renderOrder = 1;
          child.visible = true;
        } else {
          // HIDE this mesh
          hiddenParts.push(child.name || "unnamed");
          console.log(`❌ HIDE  "${child.name}" — ${colorInfo}`);
          child.visible = false;
        }
      }
    });

    console.log(`\nKept ${goldParts.length} gold parts: ${goldParts.join(", ")}`);
    console.log(`Hidden ${hiddenParts.length} non-gold parts: ${hiddenParts.join(", ")}`);
    console.log("=====================================");

    // If NO gold parts found, show ALL parts as fallback
    if (goldParts.length === 0) {
      console.warn("[MARK3] No gold parts detected! Showing all meshes as fallback.");
      model.traverse((child) => {
        if (child.isMesh) {
          child.visible = true;
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((mat) => {
            mat.side = THREE.DoubleSide;
            mat.depthWrite = true;
            mat.needsUpdate = true;
          });
          child.renderOrder = 1;
        }
      });
    }
  }

  /**
   * Set up the loaded model — only gold faceplate parts.
   * Sizes to cover the front of the face and sticks flat to it.
   */
  _setupHelmet(model) {
    if (this.helmetWrapper) {
      this.helmetRoot.remove(this.helmetWrapper);
    }

    this.helmetModel = model;
    this._prepareModel(this.helmetModel);

    // Bounding box of ONLY visible (gold) parts
    const box = new THREE.Box3();
    this.helmetModel.traverse((child) => {
      if (child.isMesh && child.visible) {
        const meshBox = new THREE.Box3().setFromObject(child);
        box.union(meshBox);
      }
    });

    // Fallback if box is empty
    if (box.isEmpty()) {
      box.setFromObject(this.helmetModel);
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    console.log(`[MARK3] Gold parts size: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`);
    console.log(`[MARK3] Gold parts center: ${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)}`);

    // Center the gold parts at origin
    this.helmetModel.position.set(-center.x, -center.y, -center.z);

    // Scale so the faceplate covers the face (~30cm wide for a face)
    const maxDim = Math.max(size.x, size.y, size.z);
    const desiredSize = 32; // Slightly smaller than full helmet — just faceplate
    const scaleFactor = desiredSize / maxDim;

    const wrapper = new THREE.Group();
    wrapper.add(this.helmetModel);
    wrapper.scale.setScalar(scaleFactor);

    // Position: move slightly forward (toward camera) so it sits ON the face
    // and shift up slightly so it centers on the nose/eyes area
    const scaledHeight = size.y * scaleFactor;
    wrapper.position.set(0, scaledHeight * 0.05, 1.5);

    this.helmetWrapper = wrapper;
    this.helmetRoot.add(wrapper);

    console.log(`[MARK3] Faceplate loaded. Scale: ${scaleFactor.toFixed(4)}`);
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
   * Called when face is NOT detected — keep faceplate visible for a while
   * so it doesn't disappear when a hand briefly blocks the face.
   */
  onFaceLost() {
    this._faceDetected = false;
    const elapsed = performance.now() - this._lastFaceTime;
    if (elapsed > this._persistMs) {
      this.helmetRoot.visible = false;
    }
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
