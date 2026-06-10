/**
 * sceneManager.js
 *
 * Sets up the Three.js scene:
 *  - WebGL renderer composited over the webcam feed
 *  - Perspective camera matched to webcam FOV
 *  - PBR lighting (directional + ambient + hemisphere)
 *  - Procedural Iron Man Mark 3 helmet built from Three.js primitives
 *  - GLTFLoader for custom model drag-and-drop
 *  - Face-occlusion mesh to hide the back of the helmet
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OneEuroFilterVec } from "./oneEuroFilter.js";

// ─── Procedural Mark 3 Helmet ───────────────────────────────────────────────

function createHelmetMaterials() {
  const red = new THREE.MeshStandardMaterial({
    color: 0x8b0000,
    metalness: 0.85,
    roughness: 0.25,
  });

  const gold = new THREE.MeshStandardMaterial({
    color: 0xdaa520,
    metalness: 0.9,
    roughness: 0.2,
  });

  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    metalness: 0.95,
    roughness: 0.3,
  });

  const eyeGlow = new THREE.MeshStandardMaterial({
    color: 0x87ceeb,
    emissive: 0x87ceeb,
    emissiveIntensity: 3.0,
    metalness: 0.0,
    roughness: 0.0,
  });

  return { red, gold, darkMetal, eyeGlow };
}

function createProceduralHelmet() {
  const group = new THREE.Group();
  const mats = createHelmetMaterials();

  // ── Main skull dome ──
  const skullGeo = new THREE.SphereGeometry(1, 64, 64, 0, Math.PI * 2, 0, Math.PI * 0.65);
  const skull = new THREE.Mesh(skullGeo, mats.red);
  skull.scale.set(1.0, 1.1, 1.05);
  skull.position.set(0, 0.15, -0.05);
  group.add(skull);

  // ── Side panels (gold) ──
  for (const side of [-1, 1]) {
    const panelGeo = new THREE.SphereGeometry(0.35, 32, 32, 0, Math.PI, 0, Math.PI * 0.5);
    const panel = new THREE.Mesh(panelGeo, mats.gold);
    panel.position.set(side * 0.75, -0.1, 0.15);
    panel.scale.set(0.6, 0.9, 0.7);
    panel.rotation.z = side * 0.3;
    group.add(panel);
  }

  // ── Faceplate ──
  const faceplateGeo = new THREE.SphereGeometry(0.95, 64, 64, Math.PI * 0.25, Math.PI * 0.5, Math.PI * 0.15, Math.PI * 0.45);
  const faceplate = new THREE.Mesh(faceplateGeo, mats.gold);
  faceplate.position.set(0, -0.15, 0.25);
  faceplate.scale.set(1.0, 0.9, 0.9);
  faceplate.name = "faceplate";
  group.add(faceplate);

  // ── Chin guard ──
  const chinGeo = new THREE.BoxGeometry(0.6, 0.25, 0.4);
  chinGeo.translate(0, 0, 0);
  const chin = new THREE.Mesh(chinGeo, mats.red);
  chin.position.set(0, -0.65, 0.3);
  group.add(chin);

  // ── Jaw lines (dark metal seams) ──
  for (const side of [-1, 1]) {
    const jawGeo = new THREE.BoxGeometry(0.08, 0.5, 0.15);
    const jaw = new THREE.Mesh(jawGeo, mats.darkMetal);
    jaw.position.set(side * 0.45, -0.35, 0.35);
    jaw.rotation.z = side * 0.15;
    group.add(jaw);
  }

  // ── Eye slits (glowing) ──
  for (const side of [-1, 1]) {
    const eyeGeo = new THREE.BoxGeometry(0.28, 0.09, 0.12);
    const eye = new THREE.Mesh(eyeGeo, mats.eyeGlow);
    eye.position.set(side * 0.28, -0.05, 0.8);
    eye.rotation.z = side * -0.15;
    eye.name = "eye";
    group.add(eye);

    // Glow sprite behind each eye
    const spriteMat = new THREE.SpriteMaterial({
      color: 0x87ceeb,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.copy(eye.position);
    sprite.scale.set(0.5, 0.3, 1);
    sprite.name = "eyeGlow";
    group.add(sprite);
  }

  // ── Forehead ridge ──
  const ridgeGeo = new THREE.BoxGeometry(0.12, 0.08, 0.6);
  const ridge = new THREE.Mesh(ridgeGeo, mats.darkMetal);
  ridge.position.set(0, 0.25, 0.45);
  group.add(ridge);

  // ── Top crest ──
  const crestGeo = new THREE.CylinderGeometry(0.06, 0.04, 0.5, 16);
  const crest = new THREE.Mesh(crestGeo, mats.darkMetal);
  crest.position.set(0, 0.65, -0.05);
  crest.rotation.x = Math.PI * 0.15;
  group.add(crest);

  // ── Ear covers ──
  for (const side of [-1, 1]) {
    const earGeo = new THREE.CylinderGeometry(0.15, 0.12, 0.08, 16);
    const ear = new THREE.Mesh(earGeo, mats.darkMetal);
    ear.position.set(side * 0.95, 0.0, -0.05);
    ear.rotation.z = Math.PI / 2;
    group.add(ear);
  }

  // ── Neck guard ──
  const neckGeo = new THREE.CylinderGeometry(0.55, 0.65, 0.35, 32, 1, true);
  const neck = new THREE.Mesh(neckGeo, mats.red);
  neck.position.set(0, -0.75, 0.0);
  group.add(neck);

  // Scale everything to roughly head-size in MediaPipe metric space
  group.scale.set(0.08, 0.08, 0.08);

  return group;
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
    this.renderer.toneMappingExposure = 1.2;

    // Scene
    this.scene = new THREE.Scene();

    // Camera – we'll update FOV/aspect once the video dimensions are known
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.01, 100);
    this.camera.position.set(0, 0, 0);

    // Lighting
    this._setupLights();

    // Helmet group
    this.helmetRoot = new THREE.Group();
    this.scene.add(this.helmetRoot);

    this.proceduralHelmet = createProceduralHelmet();
    this.helmetRoot.add(this.proceduralHelmet);

    // One Euro Filters for position and rotation
    this.posFilter = new OneEuroFilterVec(3, 30, 0.8, 0.5, 1.0);
    this.quatFilter = new OneEuroFilterVec(4, 30, 0.5, 0.3, 1.0);

    // Custom model placeholder
    this.customModel = null;

    // Offset tweaks (can be adjusted from UI)
    this.positionOffset = new THREE.Vector3(0, 0, 0);
    this.scaleMultiplier = 1.0;
    this.rotationOffset = new THREE.Euler(0, 0, 0);

    // GLTF loader
    this.gltfLoader = new GLTFLoader();
  }

  _setupLights() {
    // Strong directional light from upper-right
    const dir = new THREE.DirectionalLight(0xffffff, 2.5);
    dir.position.set(2, 3, 4);
    this.scene.add(dir);

    // Fill light from left
    const fill = new THREE.DirectionalLight(0xaaccff, 1.0);
    fill.position.set(-3, 1, 2);
    this.scene.add(fill);

    // Hemisphere for ambient
    const hemi = new THREE.HemisphereLight(0xffeedd, 0x223344, 1.5);
    this.scene.add(hemi);

    // Subtle rim light from behind
    const rim = new THREE.DirectionalLight(0xff4400, 0.6);
    rim.position.set(0, 0, -4);
    this.scene.add(rim);
  }

  /**
   * Match the Three.js camera to the webcam resolution.
   */
  updateCameraForVideo(videoWidth, videoHeight) {
    const aspect = videoWidth / videoHeight;
    this.camera.aspect = aspect;

    // A typical webcam has roughly 50–60° vertical FOV.
    // MediaPipe's metric 3D space assumes a pinhole camera with this FOV.
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();

    // Pass false so Three.js does not set inline styles that override CSS width/height
    this.renderer.setSize(videoWidth, videoHeight, false);
  }

  /**
   * Apply the 4×4 facial transformation matrix from MediaPipe.
   */
  applyFaceMatrix(matrixData, timestamp) {
    if (!matrixData) return;

    const m = new THREE.Matrix4().fromArray(matrixData);

    // Decompose to apply offsets and filter
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    m.decompose(pos, quat, scale);

    // Validate inputs to prevent NaNs from propagating
    if (
      isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z) ||
      isNaN(quat.x) || isNaN(quat.y) || isNaN(quat.z) || isNaN(quat.w)
    ) {
      return;
    }

    // Filter position and rotation
    const smoothedPosArr = this.posFilter.filter([pos.x, pos.y, pos.z], timestamp);
    const smoothedPos = new THREE.Vector3().fromArray(smoothedPosArr);

    const smoothedQuatArr = this.quatFilter.filter([quat.x, quat.y, quat.z, quat.w], timestamp);
    const smoothedQuat = new THREE.Quaternion().fromArray(smoothedQuatArr).normalize();

    // Apply translation offset
    smoothedPos.add(this.positionOffset);

    // Reconstruct
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
          // Remove previous custom model
          if (this.customModel) {
            this.helmetRoot.remove(this.customModel);
          }
          // Hide procedural helmet
          this.proceduralHelmet.visible = false;

          this.customModel = gltf.scene;

          // Auto-center and scale the model
          const box = new THREE.Box3().setFromObject(this.customModel);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const desiredSize = 0.18; // roughly head-sized in metric space
          const scaleFactor = desiredSize / maxDim;

          this.customModel.position.sub(center);
          this.customModel.scale.setScalar(scaleFactor);

          this.helmetRoot.add(this.customModel);

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

  /**
   * Switch back to the procedural helmet.
   */
  useProceduralHelmet() {
    if (this.customModel) {
      this.helmetRoot.remove(this.customModel);
      this.customModel = null;
    }
    this.proceduralHelmet.visible = true;
  }

  /**
   * Change the metallic finish preset.
   */
  setFinishPreset(preset) {
    const meshes = [];
    this.proceduralHelmet.traverse((child) => {
      if (child.isMesh) meshes.push(child);
    });

    const presets = {
      classic: {
        primary: 0x8b0000,
        secondary: 0xdaa520,
        eye: 0x87ceeb,
      },
      stealth: {
        primary: 0x2a2a2a,
        secondary: 0x4a4a4a,
        eye: 0x00ff88,
      },
      titanium: {
        primary: 0x888888,
        secondary: 0xaaaaaa,
        eye: 0xffaa00,
      },
      carbon: {
        primary: 0x111111,
        secondary: 0x333333,
        eye: 0xff0040,
      },
    };

    const p = presets[preset] || presets.classic;

    meshes.forEach((m) => {
      if (m.name === "eye") {
        m.material.color.setHex(p.eye);
        m.material.emissive.setHex(p.eye);
      } else if (m.name === "faceplate") {
        m.material.color.setHex(p.secondary);
      } else if (m.material.color) {
        // Red parts → primary, Gold parts stay secondary
        const hex = m.material.color.getHex();
        if (hex === 0x8b0000 || m.material.color.r > 0.4) {
          m.material.color.setHex(p.primary);
        }
      }
    });

    // Update glow sprites
    this.proceduralHelmet.traverse((child) => {
      if (child.isSprite && child.name === "eyeGlow") {
        child.material.color.setHex(p.eye);
      }
    });
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
