import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.162.0/examples/jsm/controls/OrbitControls.js";

const TEXTURE_URLS = {
  earthDay: "https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg",
  earthNormal: "https://threejs.org/examples/textures/planets/earth_normal_2048.jpg",
  earthSpecular: "https://threejs.org/examples/textures/planets/earth_specular_2048.jpg",
  earthNight: "https://threejs.org/examples/textures/planets/earth_lights_2048.png",
  earthClouds: "https://threejs.org/examples/textures/planets/earth_clouds_1024.png"
};

const sceneElement = document.querySelector("#scene");
const loadingElement = document.querySelector("#loading");
const toggleButton = document.querySelector("#toggle-rotation");
const statusElement = document.querySelector("#rotation-status");

const state = {
  isRotating: true,
  meshesReady: false
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 350);
camera.position.set(0.18, 0.34, 3.55);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  powerPreference: "high-performance"
});

const maxPixelRatio = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4 ? 1.3 : 1.9;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
sceneElement.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
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

const sunLight = new THREE.DirectionalLight(0xffffff, 1.8);
sunLight.position.set(5.4, 2.2, 5.8);
scene.add(sunLight);

const earthSystem = new THREE.Group();
scene.add(earthSystem);

const tiltedPivot = new THREE.Group();
tiltedPivot.rotation.z = THREE.MathUtils.degToRad(-23.4);
earthSystem.add(tiltedPivot);

const starLayers = [];
createStarLayer(2600, 24, 80, 0.016);
createStarLayer(1800, 70, 145, 0.006);

const clock = new THREE.Clock();

let earthMesh;
let cloudsMesh;
let atmosphereMesh;
let nightLightsMesh;

toggleButton.addEventListener("click", () => {
  state.isRotating = !state.isRotating;
  toggleButton.textContent = state.isRotating ? "暂停旋转" : "继续旋转";
  statusElement.textContent = state.isRotating ? "正在旋转" : "已暂停";
});

renderer.domElement.addEventListener("dblclick", () => {
  controls.reset();
});

window.addEventListener("resize", handleResize);

init().then(() => {
  handleResize();
  renderer.setAnimationLoop(animate);
});

async function init() {
  try {
    const textures = await loadTextures();
    buildEarth(textures);
    state.meshesReady = true;
    loadingElement.classList.add("hidden");
    loadingElement.textContent = "";
  } catch (error) {
    console.error("Texture loading failed, fallback to simple earth material", error);
    buildEarth(null);
    loadingElement.textContent = "Texture fallback mode";
    window.setTimeout(() => loadingElement.classList.add("hidden"), 900);
    state.meshesReady = true;
  }
}

function buildEarth(textures) {
  const segmentCount = maxPixelRatio <= 1.3 ? 86 : 128;
  const globeGeometry = new THREE.SphereGeometry(1, segmentCount, segmentCount);

  const earthMaterial = textures
    ? new THREE.MeshPhongMaterial({
        map: textures.earthDay,
        normalMap: textures.earthNormal,
        normalScale: new THREE.Vector2(0.85, 0.85),
        specularMap: textures.earthSpecular,
        specular: new THREE.Color(0x31506f),
        shininess: 22
      })
    : new THREE.MeshPhongMaterial({
        color: 0x4a98d1,
        shininess: 18,
        specular: new THREE.Color(0x204c6a)
      });

  earthMesh = new THREE.Mesh(globeGeometry, earthMaterial);
  tiltedPivot.add(earthMesh);

  if (textures) {
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

  const [earthDay, earthNormal, earthSpecular, earthNight, earthClouds] = await Promise.all([
    loadTexture(loader, TEXTURE_URLS.earthDay),
    loadTexture(loader, TEXTURE_URLS.earthNormal, { colorSpace: THREE.NoColorSpace }),
    loadTexture(loader, TEXTURE_URLS.earthSpecular, { colorSpace: THREE.NoColorSpace }),
    loadTexture(loader, TEXTURE_URLS.earthNight),
    loadTexture(loader, TEXTURE_URLS.earthClouds)
  ]);

  [earthDay, earthNight, earthClouds].forEach((texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
  });

  [earthNormal, earthSpecular].forEach((texture) => {
    texture.anisotropy = anisotropy;
  });

  return { earthDay, earthNormal, earthSpecular, earthNight, earthClouds };
}

function loadTexture(loader, url, options = {}) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (texture) => {
        if (options.colorSpace) {
          texture.colorSpace = options.colorSpace;
        }
        resolve(texture);
      },
      undefined,
      reject
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

  if (nightLightsMesh) {
    const sunDirection = sunLight.position.clone().normalize();
    nightLightsMesh.material.uniforms.sunDirection.value.copy(sunDirection);
  }

  controls.update();
  renderer.render(scene, camera);
}
