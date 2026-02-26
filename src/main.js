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
const TAU = Math.PI * 2;
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const STATIC_SUN_DIRECTION = new THREE.Vector3(0.68, 0.28, 0.73).normalize();

const sceneElement = document.querySelector("#scene");
const loadingElement = document.querySelector("#loading");
const toggleButton = document.querySelector("#toggle-rotation");
const statusElement = document.querySelector("#rotation-status");

const toggleSolar = document.querySelector("#toggle-solar");
const toggleWind = document.querySelector("#toggle-wind");
const toggleCurrent = document.querySelector("#toggle-current");
const toggleCoupling = document.querySelector("#toggle-coupling");
const timeSpeedSelect = document.querySelector("#time-speed");
const utcReadout = document.querySelector("#utc-readout");
const flowReadout = document.querySelector("#flow-readout");

const state = {
  isRotating: true,
  meshesReady: false,
  bootDone: false,
  system: {
    solarEnabled: true,
    windEnabled: true,
    currentEnabled: true,
    couplingEnabled: true
  },
  simulation: {
    timeScale: 60,
    timeMs: Date.now(),
    readoutTimer: 0
  }
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
let earthMaterial = null;
let cloudsMesh = null;
let atmosphereMesh = null;
let nightLightsMesh = null;

let windLayer = null;
let currentLayer = null;

const scratch = {
  sunDirection: new THREE.Vector3(),
  staticSun: STATIC_SUN_DIRECTION.clone()
};

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
  controls.minDistance = 1.65;
  controls.maxDistance = 7.5;
  controls.minPolarAngle = Math.PI * 0.16;
  controls.maxPolarAngle = Math.PI * 0.84;
  controls.target.set(0, 0, 0);

  const ambientLight = new THREE.AmbientLight(0x97a9bf, 0.42);
  scene.add(ambientLight);

  const hemisphereLight = new THREE.HemisphereLight(0x8dc4ff, 0x0b1322, 0.42);
  scene.add(hemisphereLight);

  sunLight = new THREE.DirectionalLight(0xffffff, 1.9);
  sunLight.position.copy(scratch.staticSun).multiplyScalar(7.2);
  scene.add(sunLight);

  createStarLayer(2600, 24, 80, 0.016);
  createStarLayer(1800, 70, 145, 0.006);

  setupUiBindings();

  renderer.domElement.addEventListener("dblclick", () => {
    controls.reset();
  });

  window.addEventListener("resize", handleResize);

  runBootSequence()
    .then(() => {
      alignInitialEarthFacing();
      handleResize();
      renderer.setAnimationLoop(animate);
    })
    .catch((error) => {
      console.error("Boot sequence failed", error);
      if (!state.bootDone) {
        buildEarth({});
        ensureSystemLayers();
        finishBoot("资源加载超时，已启用基础模式");
      }
      alignInitialEarthFacing();
      handleResize();
      renderer.setAnimationLoop(animate);
    });
}

function setupUiBindings() {
  toggleButton.addEventListener("click", () => {
    state.isRotating = !state.isRotating;
    toggleButton.textContent = state.isRotating ? "暂停旋转" : "继续旋转";
    statusElement.textContent = state.isRotating ? "正在旋转" : "已暂停";
  });

  if (toggleSolar) {
    toggleSolar.checked = state.system.solarEnabled;
    toggleSolar.addEventListener("change", () => {
      state.system.solarEnabled = toggleSolar.checked;
    });
  }

  if (toggleWind) {
    toggleWind.checked = state.system.windEnabled;
    toggleWind.addEventListener("change", () => {
      state.system.windEnabled = toggleWind.checked;
      if (windLayer) {
        windLayer.group.visible = state.system.windEnabled;
      }
    });
  }

  if (toggleCurrent) {
    toggleCurrent.checked = state.system.currentEnabled;
    toggleCurrent.addEventListener("change", () => {
      state.system.currentEnabled = toggleCurrent.checked;
      if (currentLayer) {
        currentLayer.group.visible = state.system.currentEnabled;
      }
    });
  }

  if (toggleCoupling) {
    toggleCoupling.checked = state.system.couplingEnabled;
    toggleCoupling.addEventListener("change", () => {
      state.system.couplingEnabled = toggleCoupling.checked;
    });
  }

  if (timeSpeedSelect) {
    timeSpeedSelect.value = String(state.simulation.timeScale);
    timeSpeedSelect.addEventListener("change", () => {
      const next = Number(timeSpeedSelect.value);
      if (Number.isFinite(next) && next > 0) {
        state.simulation.timeScale = next;
      }
    });
  }
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
  ensureSystemLayers();

  if (textures.earthDay) {
    finishBoot("");
  } else {
    finishBoot("纹理受限，已启用简化模式");
  }
}

function buildEarth(textures) {
  if (earthMesh) {
    return;
  }

  const segmentCount = maxPixelRatio <= 1.3 ? 96 : 148;
  const globeGeometry = new THREE.SphereGeometry(1, segmentCount, segmentCount);

  const hasDay = Boolean(textures?.earthDay);

  earthMaterial = new THREE.MeshPhongMaterial({
    color: hasDay ? 0xffffff : 0x4a98d1,
    shininess: 22,
    specular: new THREE.Color(0x31506f),
    map: textures?.earthDay || null,
    normalMap: textures?.earthNormal || null,
    specularMap: textures?.earthSpecular || null,
    normalScale: new THREE.Vector2(0.88, 0.88)
  });

  earthMesh = new THREE.Mesh(globeGeometry, earthMaterial);
  tiltedPivot.add(earthMesh);

  if (textures?.earthClouds) {
    cloudsMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.0115, segmentCount, segmentCount),
      new THREE.MeshPhongMaterial({
        map: textures.earthClouds,
        transparent: true,
        opacity: 0.34,
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
    new THREE.SphereGeometry(1.026, 96, 96),
    createAtmosphereMaterial()
  );
  tiltedPivot.add(atmosphereMesh);
}

function ensureSystemLayers() {
  if (windLayer || currentLayer) {
    return;
  }

  windLayer = createFlowLayer({
    id: "wind",
    count: maxPixelRatio <= 1.3 ? 540 : 920,
    radius: 1.032,
    speedToDegrees: 7.8,
    lineLength: 1.3,
    speedRange: 2.25,
    opacity: 0.62,
    colorA: new THREE.Color(0x50c8ff),
    colorB: new THREE.Color(0xd8fbff),
    sampler: sampleWindField
  });

  currentLayer = createFlowLayer({
    id: "current",
    count: maxPixelRatio <= 1.3 ? 460 : 760,
    radius: 1.013,
    speedToDegrees: 5.6,
    lineLength: 1.05,
    speedRange: 1.7,
    opacity: 0.72,
    colorA: new THREE.Color(0x2fa8ff),
    colorB: new THREE.Color(0x55ffe7),
    sampler: sampleCurrentField
  });

  tiltedPivot.add(windLayer.group);
  tiltedPivot.add(currentLayer.group);

  windLayer.group.visible = state.system.windEnabled;
  currentLayer.group.visible = state.system.currentEnabled;
}

function createFlowLayer(config) {
  const positionArray = new Float32Array(config.count * 6);
  const colorArray = new Float32Array(config.count * 6);
  const latitudes = new Float32Array(config.count);
  const longitudes = new Float32Array(config.count);
  const seeds = new Float32Array(config.count);

  for (let i = 0; i < config.count; i += 1) {
    latitudes[i] = (Math.asin(THREE.MathUtils.randFloatSpread(2)) * RAD2DEG * 0.95);
    longitudes[i] = THREE.MathUtils.randFloatSpread(360);
    seeds[i] = Math.random();
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(positionArray, 3);
  const colorAttr = new THREE.BufferAttribute(colorArray, 3);
  positionAttr.setUsage(THREE.DynamicDrawUsage);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttr);
  geometry.setAttribute("color", colorAttr);

  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: config.opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const lines = new THREE.LineSegments(geometry, material);

  const group = new THREE.Group();
  group.name = `${config.id}-layer`;
  group.add(lines);

  return {
    id: config.id,
    count: config.count,
    radius: config.radius,
    speedToDegrees: config.speedToDegrees,
    lineLength: config.lineLength,
    speedRange: config.speedRange,
    colorA: config.colorA,
    colorB: config.colorB,
    sampler: config.sampler,
    latitudes,
    longitudes,
    seeds,
    positionArray,
    colorArray,
    positionAttr,
    colorAttr,
    group,
    meanSpeed: 0,
    meanZonal: 0
  };
}

function createNightLightMaterial(nightTexture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      nightMap: { value: nightTexture },
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      glowStrength: { value: 1.42 }
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
        float alpha = clamp(max(max(color.r, color.g), color.b) * 1.25, 0.0, 0.86);
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
      dayColor: { value: new THREE.Color(0x8fd8ff) },
      nightColor: { value: new THREE.Color(0x16355f) },
      twilightColor: { value: new THREE.Color(0xffbd7c) },
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      rimPower: { value: 6.4 },
      baseIntensity: { value: 0.15 },
      dayBoost: { value: 0.16 },
      nightBoost: { value: 0.05 },
      twilightBoost: { value: 0.11 }
    },
    vertexShader: `
      varying vec3 vNormalWorld;
      varying vec3 vViewDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormalWorld = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 dayColor;
      uniform vec3 nightColor;
      uniform vec3 twilightColor;
      uniform vec3 sunDirection;
      uniform float rimPower;
      uniform float baseIntensity;
      uniform float dayBoost;
      uniform float nightBoost;
      uniform float twilightBoost;
      varying vec3 vNormalWorld;
      varying vec3 vViewDir;
      void main() {
        vec3 normal = normalize(vNormalWorld);
        vec3 viewDir = normalize(vViewDir);
        vec3 sunDir = normalize(sunDirection);

        float rim = pow(1.0 - max(dot(normal, viewDir), 0.0), rimPower);
        float lit = dot(normal, sunDir);
        float dayMask = smoothstep(-0.08, 0.52, lit);
        float twilightMask = smoothstep(0.24, 0.0, abs(lit));

        float variation = sin(dot(normal, vec3(19.0, 27.0, 31.0))) * 0.03 + 0.97;
        float band = baseIntensity + mix(nightBoost, dayBoost, dayMask) + twilightMask * twilightBoost;
        float intensity = rim * band * variation;

        vec3 tone = mix(nightColor, dayColor, dayMask);
        tone += twilightColor * twilightMask * 0.2;

        float alpha = clamp(intensity * 0.92, 0.0, 0.36);
        gl_FragColor = vec4(tone * intensity, alpha);
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
    const theta = Math.random() * TAU;

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
  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  state.simulation.timeMs += delta * 1000 * state.simulation.timeScale;
  const simDate = new Date(state.simulation.timeMs);
  const solarContext = computeSolarContext(simDate);

  const sunDirection = state.system.solarEnabled ? solarContext.sunDirection : scratch.staticSun;
  sunLight.position.copy(sunDirection).multiplyScalar(7.2);
  sunLight.intensity = state.system.solarEnabled ? 1.92 : 1.65;

  if (state.isRotating && state.meshesReady) {
    earthSystem.rotation.y += delta * 0.165;
  }

  if (cloudsMesh) {
    const drift = getCloudDriftSpeed();
    cloudsMesh.rotation.y += delta * drift;
  }

  if (atmosphereMesh) {
    atmosphereMesh.rotation.y += delta * 0.01;
  }

  starLayers.forEach((layer, index) => {
    layer.rotation.y += delta * (index === 0 ? 0.003 : 0.0012);
    layer.rotation.x = Math.sin(elapsed * 0.05 + index * 0.4) * 0.02;
  });

  if (nightLightsMesh) {
    nightLightsMesh.material.uniforms.sunDirection.value.copy(sunDirection);
  }

  if (atmosphereMesh?.material?.uniforms?.sunDirection) {
    atmosphereMesh.material.uniforms.sunDirection.value.copy(sunDirection);
  }

  if (windLayer) {
    windLayer.group.visible = state.system.windEnabled;
    updateFlowLayer(windLayer, delta, solarContext);
  }

  if (currentLayer) {
    currentLayer.group.visible = state.system.currentEnabled;
    updateFlowLayer(currentLayer, delta, solarContext);
  }

  applyCoupling();
  updateReadouts(delta, simDate, solarContext);

  controls.update();
  renderer.render(scene, camera);
}

function getCloudDriftSpeed() {
  if (!state.system.couplingEnabled) {
    return 0.062;
  }

  const windInfluence = windLayer ? clamp(windLayer.meanSpeed / windLayer.speedRange, 0, 1) : 0;
  const timeBoost = state.simulation.timeScale > 1 ? Math.log10(state.simulation.timeScale + 1) * 0.006 : 0;
  return 0.038 + windInfluence * 0.037 + timeBoost;
}

function applyCoupling() {
  if (!earthMaterial) {
    return;
  }

  if (!state.system.couplingEnabled) {
    earthMaterial.shininess = 22;
    earthMaterial.specular.set(0x31506f);
    return;
  }

  const windFactor = windLayer ? clamp(windLayer.meanSpeed / windLayer.speedRange, 0, 1) : 0;
  const currentFactor = currentLayer ? clamp(currentLayer.meanSpeed / currentLayer.speedRange, 0, 1) : 0;

  earthMaterial.shininess = 20 + currentFactor * 16 + windFactor * 6;
  earthMaterial.specular.setRGB(
    0.19 + currentFactor * 0.16,
    0.30 + currentFactor * 0.18,
    0.42 + windFactor * 0.12
  );
}

function updateFlowLayer(layer, delta, solarContext) {
  if (!layer.group.visible) {
    layer.meanSpeed = 0;
    layer.meanZonal = 0;
    return;
  }

  const positionArray = layer.positionArray;
  const colorArray = layer.colorArray;

  let sumSpeed = 0;
  let sumZonal = 0;

  for (let i = 0; i < layer.count; i += 1) {
    let lat = layer.latitudes[i];
    let lon = layer.longitudes[i];

    const sampled = layer.sampler(lat, lon, solarContext, layer.seeds[i]);
    const u = sampled.u;
    const v = sampled.v;
    const speed = Math.hypot(u, v);

    sumSpeed += speed;
    sumZonal += u;

    const cosLat = Math.max(Math.cos(lat * DEG2RAD), 0.2);
    const drift = layer.speedToDegrees * delta;

    lat += v * drift;
    lon += (u * drift) / cosLat;

    if (lat > 84) {
      lat = 84 - (lat - 84);
      lon += 180;
    } else if (lat < -84) {
      lat = -84 - (lat + 84);
      lon += 180;
    }

    lon = normalizeLongitude(lon);

    layer.latitudes[i] = lat;
    layer.longitudes[i] = lon;

    const lineStep = layer.lineLength * (0.45 + speed * 0.7);
    const endLat = clamp(lat + v * lineStep, -85, 85);
    const endLon = normalizeLongitude(lon + (u * lineStep) / Math.max(Math.cos(endLat * DEG2RAD), 0.2));

    const base = i * 6;
    writeLatLonToArray(lat, lon, layer.radius, positionArray, base);
    writeLatLonToArray(endLat, endLon, layer.radius, positionArray, base + 3);

    const intensity = clamp(speed / layer.speedRange, 0, 1);
    const r = THREE.MathUtils.lerp(layer.colorA.r, layer.colorB.r, intensity);
    const g = THREE.MathUtils.lerp(layer.colorA.g, layer.colorB.g, intensity);
    const b = THREE.MathUtils.lerp(layer.colorA.b, layer.colorB.b, intensity);

    colorArray[base] = r;
    colorArray[base + 1] = g;
    colorArray[base + 2] = b;
    colorArray[base + 3] = r;
    colorArray[base + 4] = g;
    colorArray[base + 5] = b;
  }

  layer.meanSpeed = sumSpeed / layer.count;
  layer.meanZonal = sumZonal / layer.count;
  layer.positionAttr.needsUpdate = true;
  layer.colorAttr.needsUpdate = true;
}

function sampleWindField(lat, lon, solarContext, seed) {
  const seasonalShift = solarContext.subsolarLat * 0.42;
  const shiftedLat = lat - seasonalShift;
  const absShifted = Math.abs(shiftedLat);

  let u = 0;
  let v = 0;

  u += -0.85 * gaussian(absShifted, 15, 14);
  u += 0.95 * gaussian(absShifted, 44, 13);
  u += -0.36 * gaussian(absShifted, 72, 10);

  v += -Math.sign(shiftedLat) * 0.26 * gaussian(absShifted, 9, 24);

  const jetNorth = gaussian(lat, 34 + seasonalShift * 0.5, 7);
  const jetSouth = gaussian(lat, -34 + seasonalShift * 0.5, 7);
  u += 0.74 * (jetNorth + jetSouth) *
    (1 + 0.22 * Math.sin((lon * 3.0 + solarContext.dayProgress * 720 + seed * 60) * DEG2RAD));

  u += 0.11 * Math.sin((lon * 2.2 + solarContext.dayProgress * 540 + seed * 120) * DEG2RAD) *
    Math.cos(lat * DEG2RAD * 1.4);
  v += 0.09 * Math.cos((lon * 1.8 - solarContext.dayProgress * 480 + seed * 80) * DEG2RAD) *
    Math.sin((lat - seasonalShift) * DEG2RAD);

  return { u, v };
}

function sampleCurrentField(lat, lon, solarContext, seed) {
  let u = 0;
  let v = 0;

  u += -0.48 * gaussian(lat, 0, 12);
  u += 0.22 * gaussian(lat, 7, 6);
  u += 0.33 * gaussian(Math.abs(lat), 40, 11);
  u += 0.52 * gaussian(lat, -57, 6);

  const gyreBand = gaussian(Math.abs(lat), 27, 18);
  v += 0.18 * Math.sin((lon * 2 + solarContext.dayProgress * 120 + seed * 90) * DEG2RAD) *
    gyreBand * (lat >= 0 ? -1 : 1);
  u += 0.10 * Math.cos((lon * 2.4 - solarContext.dayProgress * 90 + seed * 100) * DEG2RAD) * gyreBand;

  u += 0.58 * periodicLonGaussian(lon, -70, 15) * gaussian(lat, 36, 11);
  v += 0.22 * periodicLonGaussian(lon, -74, 12) * gaussian(lat, 32, 12);

  u += 0.52 * periodicLonGaussian(lon, 145, 14) * gaussian(lat, 31, 10);
  v += 0.18 * periodicLonGaussian(lon, 141, 12) * gaussian(lat, 28, 11);

  u += 0.35 * periodicLonGaussian(lon, 20, 18) * gaussian(lat, -37, 11);
  v += -0.16 * periodicLonGaussian(lon, 18, 12) * gaussian(lat, -34, 10);

  return { u, v };
}

function computeSolarContext(date) {
  const dayOfYear = getDayOfYearUTC(date);
  const utcHours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600 +
    date.getUTCMilliseconds() / 3600000;

  const gamma = TAU / 365 * (dayOfYear - 1 + (utcHours - 12) / 24);
  const declinationRad =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const equationOfTimeMin = 229.18 * (
    0.000075 +
    0.001868 * Math.cos(gamma) -
    0.032077 * Math.sin(gamma) -
    0.014615 * Math.cos(2 * gamma) -
    0.040849 * Math.sin(2 * gamma)
  );

  const subsolarLat = declinationRad * RAD2DEG;
  const subsolarLon = normalizeLongitude(180 - (utcHours * 15 + equationOfTimeMin * 0.25));

  latLonToVector(subsolarLat, subsolarLon, 1, scratch.sunDirection).normalize();

  return {
    dayOfYear,
    dayProgress: utcHours / 24,
    subsolarLat,
    subsolarLon,
    sunDirection: scratch.sunDirection
  };
}

function updateReadouts(delta, simDate, solarContext) {
  state.simulation.readoutTimer += delta;
  if (state.simulation.readoutTimer < 0.2) {
    return;
  }

  state.simulation.readoutTimer = 0;

  if (utcReadout) {
    const subsolarText = `${formatSigned(solarContext.subsolarLat)}°, ${formatSigned(solarContext.subsolarLon)}°`;
    utcReadout.textContent = `UTC ${formatUtc(simDate)} | Subsolar ${subsolarText}`;
  }

  if (flowReadout) {
    const windText = state.system.windEnabled && windLayer ? windLayer.meanSpeed.toFixed(2) : "OFF";
    const currentText = state.system.currentEnabled && currentLayer ? currentLayer.meanSpeed.toFixed(2) : "OFF";
    flowReadout.textContent = `Wind ${windText} | Current ${currentText} (relative)`;
  }
}

function alignInitialEarthFacing() {
  const solarContext = computeSolarContext(new Date(state.simulation.timeMs));
  earthSystem.rotation.y = THREE.MathUtils.degToRad(90 - solarContext.subsolarLon);
}

function writeLatLonToArray(latDeg, lonDeg, radius, target, offset) {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const cosLat = Math.cos(lat);

  target[offset] = -radius * cosLat * Math.cos(lon);
  target[offset + 1] = radius * Math.sin(lat);
  target[offset + 2] = radius * cosLat * Math.sin(lon);
}

function latLonToVector(latDeg, lonDeg, radius, target) {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const cosLat = Math.cos(lat);

  target.set(
    -radius * cosLat * Math.cos(lon),
    radius * Math.sin(lat),
    radius * cosLat * Math.sin(lon)
  );

  return target;
}

function gaussian(value, center, width) {
  const x = (value - center) / width;
  return Math.exp(-(x * x));
}

function periodicLonGaussian(lon, center, width) {
  let delta = Math.abs(lon - center) % 360;
  if (delta > 180) {
    delta = 360 - delta;
  }
  const x = delta / width;
  return Math.exp(-(x * x));
}

function getDayOfYearUTC(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const now = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.max(1, Math.floor((now - start) / 86400000));
}

function normalizeLongitude(lon) {
  let output = ((lon + 180) % 360 + 360) % 360 - 180;
  if (output === -180) {
    output = 180;
  }
  return output;
}

function formatUtc(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${mm}:${s}`;
}

function formatSigned(value) {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toFixed(1)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
