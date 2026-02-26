import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const TEXTURE_URLS = {
  earthDay: new URL("../assets/textures/earth_day.jpg", import.meta.url).href,
  earthNormal: new URL("../assets/textures/earth_normal.jpg", import.meta.url).href,
  earthSpecular: new URL("../assets/textures/earth_specular.jpg", import.meta.url).href,
  earthNight: new URL("../assets/textures/earth_night.png", import.meta.url).href,
  earthClouds: new URL("../assets/textures/earth_clouds.png", import.meta.url).href
};

const BOOT_TIMEOUT_MS = 12000;
const TEXTURE_TIMEOUT_MS = 8000;

const sceneElement = document.querySelector("#scene");
const loadingElement = document.querySelector("#loading");
const toggleButton = document.querySelector("#toggle-rotation");
const statusElement = document.querySelector("#rotation-status");

const state = {
  isRotating: true,
  meshesReady: false,
  bootDone: false
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 350);
camera.position.set(0.18, 0.34, 3.55);

const maxPixelRatio = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4 ? 1.3 : 1.9;

let renderer = null;
let controls = null;
let sunLight = null;

const earthSystem = new THREE.Group();
scene.add(earthSystem);

const tiltedPivot = new THREE.Group();
tiltedPivot.rotation.z = THREE.MathUtils.degToRad(-23.4);
earthSystem.add(tiltedPivot);

const starLayers = [];
const clock = new THREE.Clock();

let earthMesh = null;
let cloudsMesh = null;
let atmosphereMesh = null;
let nightLightsMesh = null;

bootstrap();

function bootstrap() {
  if (!supportsWebGL()) {
    failStartup("当前浏览器不支持 WebGL，无法渲染地球。", "unsupported_webgl");
    return;
  }

  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });
  } catch (error) {
    console.error("Failed to create renderer", error);
    failStartup("WebGL 初始化失败，请检查浏览器硬件加速。", "renderer_init_failed");
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  sceneElement.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.045;
  controls.enablePan = false;
  controls.minDistance = 2.1;
  controls.maxDistance = 7;
  controls.minPolarAngle = Math.PI * 0.2;
  controls.maxPolarAngle = Math.PI * 0.8;
  controls.target.set(0, 0, 0);

  const ambientLight = new THREE.AmbientLight(0x97a9bf, 0.35);
  scene.add(ambientLight);

  const hemisphereLight = new THREE.HemisphereLight(0x8dc4ff, 0x0b1322, 0.35);
  scene.add(hemisphereLight);

  sunLight = new THREE.DirectionalLight(0xffffff, 1.8);
  sunLight.position.set(5.4, 2.2, 5.8);
  scene.add(sunLight);

  createStarLayer(2600, 24, 80, 0.016);
  createStarLayer(1800, 70, 145, 0.006);

  toggleButton.addEventListener("click", () => {
    state.isRotating = !state.isRotating;
    toggleButton.textContent = state.isRotating ? "暂停旋转" : "继续旋转";
    statusElement.textContent = state.isRotating ? "正在旋转" : "已暂停";
  });

  renderer.domElement.addEventListener("dblclick", () => {
    controls.reset();
  });

  window.addEventListener("resize", handleResize);

  runBootSequence()
    .then(() => {
      handleResize();
      renderer.setAnimationLoop(animate);
    })
    .catch((error) => {
      console.error("Boot sequence failed", error);
      if (!state.bootDone) {
        buildEarth({});
        finishBoot("资源加载超时，已启用基础模式");
      }
      handleResize();
      renderer.setAnimationLoop(animate);
    });
}

async function runBootSequence() {
  setLoadingText("Loading Earth assets...");

  const textures = await Promise.race([
    loadTextures(),
    delay(BOOT_TIMEOUT_MS).then(() => {
      throw new Error("boot_timeout");
    })
  ]);

  buildEarth(textures);

  if (textures.earthDay) {
    finishBoot("");
  } else {
    finishBoot("纹理受限，已启用简化模式");
  }
}

function buildEarth(textures) {
  if (state.bootDone && earthMesh) {
    return;
  }

  const segmentCount = maxPixelRatio <= 1.3 ? 86 : 128;
  const globeGeometry = new THREE.SphereGeometry(1, segmentCount, segmentCount);

  const hasDay = Boolean(textures?.earthDay);

  const earthMaterial = new THREE.MeshPhongMaterial({
    color: hasDay ? 0xffffff : 0x4a98d1,
    shininess: 22,
    specular: new THREE.Color(0x31506f),
    map: textures?.earthDay || null,
    normalMap: textures?.earthNormal || null,
    specularMap: textures?.earthSpecular || null,
    normalScale: new THREE.Vector2(0.85, 0.85)
  });

  earthMesh = new THREE.Mesh(globeGeometry, earthMaterial);
  tiltedPivot.add(earthMesh);

  if (textures?.earthClouds) {
    cloudsMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.011, segmentCount, segmentCount),
      new THREE.MeshPhongMaterial({
        map: textures.earthClouds,
        transparent: true,
        opacity: 0.36,
        depthWrite: false
      })
    );
    tiltedPivot.add(cloudsMesh);
  }

  if (textures?.earthNight) {
    nightLightsMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.004, segmentCount, segmentCount),
      createNightLightMaterial(textures.earthNight)
    );
    tiltedPivot.add(nightLightsMesh);
  }

  atmosphereMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.09, 92, 92),
    createAtmosphereMaterial()
  );
  tiltedPivot.add(atmosphereMesh);
}

function createNightLightMaterial(nightTexture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      nightMap: { value: nightTexture },
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      glowStrength: { value: 1.45 }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalWorld;
      void main() {
        vUv = uv;
        vNormalWorld = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D nightMap;
      uniform vec3 sunDirection;
      uniform float glowStrength;
      varying vec2 vUv;
      varying vec3 vNormalWorld;
      void main() {
        float lightFacing = dot(normalize(vNormalWorld), normalize(sunDirection));
        float darkness = smoothstep(-0.24, 0.32, -lightFacing);
        vec3 lights = texture2D(nightMap, vUv).rgb;
        vec3 color = lights * darkness * glowStrength;
        float alpha = clamp(max(max(color.r, color.g), color.b) * 1.25, 0.0, 0.85);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
}

function createAtmosphereMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(0x80d5ff) }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormal = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), 3.2);
        float intensity = smoothstep(0.0, 1.0, fresnel) * 0.85;
        gl_FragColor = vec4(glowColor * intensity, intensity * 0.85);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending
  });
}

async function loadTextures() {
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);

  const requests = Object.entries(TEXTURE_URLS).map(([name, url]) =>
    loadTextureWithTimeout(loader, name, url)
  );

  const results = await Promise.allSettled(requests);
  const textures = {};

  results.forEach((result) => {
    if (result.status === "fulfilled") {
      const { name, texture } = result.value;
      texture.anisotropy = anisotropy;
      textures[name] = texture;
    } else {
      console.warn("Texture load skipped", result.reason?.message || result.reason);
    }
  });

  if (textures.earthDay) {
    textures.earthDay.colorSpace = THREE.SRGBColorSpace;
  }
  if (textures.earthNight) {
    textures.earthNight.colorSpace = THREE.SRGBColorSpace;
  }
  if (textures.earthClouds) {
    textures.earthClouds.colorSpace = THREE.SRGBColorSpace;
  }

  return textures;
}

function loadTextureWithTimeout(loader, name, url, timeoutMs = TEXTURE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`timeout:${name}`));
    }, timeoutMs);

    loader.load(
      url,
      (texture) => {
        clearTimeout(timer);
        resolve({ name, texture });
      },
      undefined,
      (error) => {
        clearTimeout(timer);
        reject(error || new Error(`failed:${name}`));
      }
    );
  });
}

function createStarLayer(count, minRadius, maxRadius, baseSize) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  const tempVector = new THREE.Vector3();
  const color = new THREE.Color();

  for (let i = 0; i < count; i += 1) {
    const radius = THREE.MathUtils.randFloat(minRadius, maxRadius);
    const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
    const theta = Math.random() * Math.PI * 2;

    tempVector.setFromSphericalCoords(radius, phi, theta);

    const index = i * 3;
    positions[index] = tempVector.x;
    positions[index + 1] = tempVector.y;
    positions[index + 2] = tempVector.z;

    color.setHSL(0.56 + Math.random() * 0.1, 0.65, 0.72 + Math.random() * 0.28);
    colors[index] = color.r;
    colors[index + 1] = color.g;
    colors[index + 2] = color.b;
  }

  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  starGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const starMaterial = new THREE.PointsMaterial({
    size: baseSize,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const stars = new THREE.Points(starGeometry, starMaterial);
  scene.add(stars);
  starLayers.push(stars);
}

function handleResize() {
  if (!renderer) {
    return;
  }

  const width = sceneElement.clientWidth;
  const height = sceneElement.clientHeight;

  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  const delta = clock.getDelta();
  const elapsed = clock.elapsedTime;

  if (state.isRotating && state.meshesReady) {
    earthSystem.rotation.y += delta * 0.18;
    if (cloudsMesh) {
      cloudsMesh.rotation.y += delta * 0.075;
    }
  }

  if (atmosphereMesh) {
    atmosphereMesh.rotation.y += delta * 0.01;
  }

  starLayers.forEach((layer, index) => {
    layer.rotation.y += delta * (index === 0 ? 0.003 : 0.0012);
    layer.rotation.x = Math.sin(elapsed * 0.05 + index * 0.4) * 0.02;
  });

  if (nightLightsMesh && sunLight) {
    const sunDirection = sunLight.position.clone().normalize();
    nightLightsMesh.material.uniforms.sunDirection.value.copy(sunDirection);
  }

  controls.update();
  renderer.render(scene, camera);
}

function finishBoot(message) {
  state.bootDone = true;
  state.meshesReady = true;

  if (message) {
    setLoadingText(message);
    window.setTimeout(() => {
      loadingElement.classList.add("hidden");
      loadingElement.textContent = "";
    }, 900);
    return;
  }

  loadingElement.classList.add("hidden");
  loadingElement.textContent = "";
}

function failStartup(message, errorCode) {
  loadingElement.classList.remove("hidden");
  loadingElement.textContent = message;
  statusElement.textContent = "渲染不可用";
  toggleButton.disabled = true;
  toggleButton.textContent = "不可用";
  console.error(`startup_error:${errorCode}`);
}

function setLoadingText(text) {
  loadingElement.classList.remove("hidden");
  loadingElement.textContent = text;
}

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch (error) {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
