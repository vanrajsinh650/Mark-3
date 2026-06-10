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
    color: 0x9e1a1a, // Slightly brighter, richer metallic red
    metalness: 0.75, // Lower metalness so it does not turn black without environment map
    roughness: 0.28,
  });

  const gold = new THREE.MeshStandardMaterial({
    color: 0xe5b83b, // Rich gold color
    metalness: 0.8,  // Adjusted for a premium satin gold look
    roughness: 0.24,
  });

  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x242424,
    metalness: 0.85,
    roughness: 0.3,
  });

  const eyeGlow = new THREE.MeshStandardMaterial({
    color: 0x87ceeb,
    emissive: 0x87ceeb,
    emissiveIntensity: 3.5,
    metalness: 0.0,
    roughness: 0.0,
  });

  return { red, gold, darkMetal, eyeGlow };
}

function createProceduralHelmet() {
  const group = new THREE.Group();
  const mats = createHelmetMaterials();

  // ── Main skull dome (Red) ──
  const skullGeo = new THREE.SphereGeometry(1, 32, 32, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const skull = new THREE.Mesh(skullGeo, mats.red);
  skull.scale.set(1.0, 1.12, 1.05);
  skull.position.set(0, 0.15, -0.05);
  group.add(skull);

  // ── Forehead Brow Plate (Red, wraps over the gold faceplate) ──
  const browPlateGeo = new THREE.BoxGeometry(0.9, 0.22, 0.35);
  const browPlate = new THREE.Mesh(browPlateGeo, mats.red);
  browPlate.position.set(0, 0.28, 0.78);
  browPlate.rotation.x = 0.22; // Tilt forward
  group.add(browPlate);

  // Forehead center seam (Dark Metal)
  const foreheadSeamGeo = new THREE.BoxGeometry(0.04, 0.25, 0.4);
  const foreheadSeam = new THREE.Mesh(foreheadSeamGeo, mats.darkMetal);
  foreheadSeam.position.set(0, 0.42, 0.72);
  foreheadSeam.rotation.x = 0.15;
  group.add(foreheadSeam);

  // ── Composite Faceplate Group (Gold, realistic contours) ──
  const faceplateGroup = new THREE.Group();
  faceplateGroup.name = "faceplate";

  // 1. Forehead band of faceplate
  const faceBrowGeo = new THREE.BoxGeometry(0.82, 0.2, 0.3);
  const faceBrow = new THREE.Mesh(faceBrowGeo, mats.gold);
  faceBrow.position.set(0, 0.12, 0.82);
  faceBrow.rotation.x = 0.12;
  faceplateGroup.add(faceBrow);

  // 2. Nose bridge
  const faceNoseGeo = new THREE.BoxGeometry(0.16, 0.35, 0.25);
  const faceNose = new THREE.Mesh(faceNoseGeo, mats.gold);
  faceNose.position.set(0, -0.1, 0.91);
  faceplateGroup.add(faceNose);

  // 3. Cheeks left and right
  for (const side of [-1, 1]) {
    const cheekGeo = new THREE.BoxGeometry(0.3, 0.48, 0.25);
    const cheek = new THREE.Mesh(cheekGeo, mats.gold);
    cheek.position.set(side * 0.3, -0.16, 0.86);
    cheek.rotation.y = side * -0.22; // angled back
    cheek.rotation.z = side * 0.12;  // tapers down
    faceplateGroup.add(cheek);
  }

  // 4. Upper mouth/lip plate
  const lipGeo = new THREE.BoxGeometry(0.48, 0.12, 0.22);
  const lip = new THREE.Mesh(lipGeo, mats.gold);
  lip.position.set(0, -0.38, 0.87);
  lip.rotation.x = -0.12;
  faceplateGroup.add(lip);

  // Tag all meshes in the faceplateGroup so they are recognized by the finish preset system
  faceplateGroup.traverse((child) => {
    if (child.isMesh) child.name = "faceplate";
  });
  group.add(faceplateGroup);

  // ── Jaw & Chin ──
  // 1. Jaw Cheeks (Red, forms lower sides of helmet)
  for (const side of [-1, 1]) {
    const jawCheekGeo = new THREE.BoxGeometry(0.38, 0.38, 0.45);
    const jawCheek = new THREE.Mesh(jawCheekGeo, mats.red);
    jawCheek.position.set(side * 0.52, -0.4, 0.65);
    jawCheek.rotation.y = side * 0.25;
    jawCheek.rotation.z = side * -0.12;
    group.add(jawCheek);
  }

  // 2. Chin Guard (Red, angular front chin)
  const chinGeo = new THREE.BoxGeometry(0.38, 0.28, 0.35);
  const chin = new THREE.Mesh(chinGeo, mats.red);
  chin.position.set(0, -0.58, 0.72);
  chin.rotation.x = -0.15;
  group.add(chin);

  // ── Ear covers (Gold/Dark Metal circular caps) ──
  for (const side of [-1, 1]) {
    const earGeo = new THREE.CylinderGeometry(0.24, 0.22, 0.12, 32);
    const ear = new THREE.Mesh(earGeo, mats.darkMetal);
    ear.position.set(side * 0.94, 0.0, 0.0);
    ear.rotation.z = Math.PI / 2;
    ear.rotation.x = 0.1;
    group.add(ear);
    
    // Gold center insert
    const earInsertGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.04, 16);
    const earInsert = new THREE.Mesh(earInsertGeo, mats.gold);
    earInsert.position.set(side * 0.99, 0.0, 0.0);
    earInsert.rotation.z = Math.PI / 2;
    group.add(earInsert);
  }

  // ── Eye slits (glowing sky blue) ──
  for (const side of [-1, 1]) {
    // Left/Right eye slits angled downwards towards center
    const eyeGeo = new THREE.BoxGeometry(0.22, 0.045, 0.08);
    const eye = new THREE.Mesh(eyeGeo, mats.eyeGlow);
    eye.position.set(side * 0.22, -0.02, 0.96);
    eye.rotation.z = side * -0.12;
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
    sprite.scale.set(0.4, 0.2, 1);
    sprite.name = "eyeGlow";
    group.add(sprite);
  }

  // ── Neck guard (Red collar) ──
  const neckGeo = new THREE.CylinderGeometry(0.68, 0.78, 0.45, 32, 1, true);
  const neck = new THREE.Mesh(neckGeo, mats.red);
  neck.position.set(0, -0.75, -0.1);
  neck.rotation.x = 0.1;
  group.add(neck);

  // Scale to head-size in MediaPipe metric space (units ≈ centimeters).
  group.scale.set(8, 8, 8);

  return group;
}

function createOccluderMesh() {
  const geo = new THREE.SphereGeometry(1.0, 32, 32);
  const mat = new THREE.MeshBasicMaterial({
    colorWrite: false, // Transparent, but blocks pixels behind it in the depth buffer
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(0.88, 1.02, 0.95); // Head-like ellipsoid
  mesh.position.set(0, 0.05, -0.1); // Sit inside the helmet skull
  mesh.scale.multiplyScalar(8); // Match metric space scale
  mesh.renderOrder = 0; // Render first
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
    this.renderer.toneMappingExposure = 1.2;

    // Scene
    this.scene = new THREE.Scene();

    // Camera – we'll update FOV/aspect once the video dimensions are known
    // Far plane must be large enough for MediaPipe's metric space (face at Z ≈ -30 to -80)
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    this.camera.position.set(0, 0, 0);
    this.scene.add(this.camera); // Add camera to scene so its relative headlight directional lights update

    // Debug frame counter
    this._debugFrameCount = 0;

    // Lighting
    this._setupLights();

    // Helmet group
    this.helmetRoot = new THREE.Group();
    this.scene.add(this.helmetRoot);

    // Occluder (simulates head volume blocking back of helmet)
    this.occluder = createOccluderMesh();
    this.helmetRoot.add(this.occluder);

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
    // Front-right key light (bright white)
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(3, 4, 5);
    this.camera.add(keyLight);

    // Left fill light (cool blue)
    const fillLight = new THREE.DirectionalLight(0xaaccff, 1.8);
    fillLight.position.set(-3, 2, 3);
    this.camera.add(fillLight);

    // Bottom bounce light (warm orange representing ground reflection)
    const bounceLight = new THREE.DirectionalLight(0xffaa44, 1.2);
    bounceLight.position.set(0, -4, 2);
    this.camera.add(bounceLight);

    // Top rim light (white)
    const rimLight = new THREE.DirectionalLight(0xffffff, 1.5);
    rimLight.position.set(0, 5, -2);
    this.camera.add(rimLight);

    // Ambient hemisphere light
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x222222, 1.0);
    this.scene.add(hemiLight);
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

    // Debug: log position values every 60 frames so we can see the coordinate space
    this._debugFrameCount++;
    if (this._debugFrameCount % 60 === 1) {
      console.log(`[MARK3 DEBUG] Face pos: x=${pos.x.toFixed(2)}, y=${pos.y.toFixed(2)}, z=${pos.z.toFixed(2)} | scale: ${scale.x.toFixed(3)}`);
    }

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
          const desiredSize = 18; // roughly head-sized in metric space (cm)
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
