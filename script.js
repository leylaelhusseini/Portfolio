import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.z = 9;

const light1 = new THREE.HemisphereLight(0xffffff, 0x998888, 1.8);
scene.add(light1);

const light2 = new THREE.DirectionalLight(0xffffff, 2.2);
light2.position.set(3, 5, 4);
scene.add(light2);

const figure = new THREE.Group();
scene.add(figure);

const FEET_Y = -2.4;
let headY = 4.1;
let zoomScale = 2.4;

let morphMeshes = [];
let headBone = null;
let headRest = null;
let avatarModel = null;

const arms = { left: null, right: null };
const forearms = { left: null, right: null };
const hands = { left: null, right: null };

function setMorph(name, value) {
  for (let i = 0; i < morphMeshes.length; i++) {
    const m = morphMeshes[i];
    const index = m.morphTargetDictionary[name];
    if (index !== undefined) {
      m.morphTargetInfluences[index] = value;
    }
  }
}

function fixCutouts(mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const label = (mesh.name +' ' + materials.map(function (m) {
    return m.name;
  }).join(' ')).toLowerCase();
  const isCutout = ['hair', 'lash', 'brow', 'beard'].some(function (word) {
    return label.indexOf(word) !== -1;
  });
  if (!isCutout) {
    return;
  }
  for (let i = 0; i < materials.length; i++) {
    const m = materials[i];
    m.transparent = false;
    m.alphaTest = 0.2;
    m.alphaToCoverage = true;
    m.depthWrite = true;
    m.side = THREE.DoubleSide;
    m.needsUpdate = true;
  }
  mesh.renderOrder = 2;
}

function aimBone(bone, direction, childName) {
  let child = null;
  if (childName) {
    child = bone.children.find(function (c) {
      return c.isBone && c.name.toLowerCase().indexOf(childName) !== -1;
    });
  }
  if (!child) {
    child = bone.children.find(function (c) {
      return c.isBone;
    });
  }
  if (!child) {
    return;
  }
  bone.updateWorldMatrix(true, true);
  
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  bone.getWorldPosition(start);
  child.getWorldPosition(end);
  const current = end.sub(start).normalize();
  const target = direction.clone().normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(current, target);
  const boneQ = new THREE.Quaternion();
  const parentQ = new THREE.Quaternion();
  bone.getWorldQuaternion(boneQ);
  bone.parent.getWorldQuaternion(parentQ);
  bone.quaternion.copy(parentQ.invert().multiply(turn.multiply(boneQ)));
  bone.updateWorldMatrix(true, true);
}

function poseArm(side, key, phase, t) {
  if (!arms[key]) {
    return;
  }
  const sway = Math.sin(t * 1.3 + phase);
  const drift = Math.sin(t * 1.1 + phase * 1.3);
  aimBone(arms[key], new THREE.Vector3(side * (0.2 + sway * 0.02), -1, -0.02 + drift * 0.02));
  if (forearms[key]) {
    aimBone(forearms[key], new THREE.Vector3(side * (0.1 + sway * 0.02), -1, 0.32 + drift * 0.03));
  }
  if (hands[key]) {
    aimBone(hands[key], new THREE.Vector3(side * 0.06, -1, 0.3), 'middle');
  }
}

const loader = new GLTFLoader();
loader.load('avatar.glb', function (gltf) {
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  model.scale.setScalar(4.5 / size.y);
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x = model.position.x - center.x;
  model.position.z = model.position.z - center.z;
  model.position.y = model.position.y - box.min.y;

  model.traverse(function (obj) {
    if (obj.isMesh) {
      fixCutouts(obj);
    }
    if (obj.isMesh && obj.morphTargetDictionary) {
      morphMeshes.push(obj);
    }
    if (obj.isBone) {
      const name = obj.name.toLowerCase();
      if (name.endsWith('leftarm')) {
        arms.left = obj;
      }
      if (name.endsWith('rightarm')) {
        arms.right = obj;
      }
      if (name.endsWith('leftforearm')) {
        forearms.left = obj;
      }
      if (name.endsWith('rightforearm')) {
        forearms.right = obj;
      }
      if (name.endsWith('lefthand')) {
        hands.left = obj;
      }
      if (name.endsWith('righthand')) {
        hands.right = obj;
      }
      if (name.endsWith('head')) {
        headBone = obj;
      }
    }
  });

  figure.add(model);
  avatarModel = model;

  if (headBone) {
    headRest = headBone.quaternion.clone();
    figure.position.set(0, 0, 0);
    figure.rotation.set(0, 0, 0);
    figure.scale.set(1, 1, 1);
    figure.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    headBone.getWorldPosition(v);
    headY = v.y + 0.22;
  }
});

const sections = document.querySelectorAll('main > section');

let stops = [];

function buildStops() {
  const halfWidth = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z * camera.aspect;
  const unitsPerPx = (halfWidth * 2) / window.innerWidth;
  let minFree = window.innerWidth;
  stops = [];
  for (let i = 0; i < sections.length; i++) {
    const rect = sections[i].querySelector('.content').getBoundingClientRect();
    const contentOnLeft = rect.left + rect.width / 2 < window.innerWidth / 2;
    let centerPx = 0;
    let free = 0;
    if (contentOnLeft) {
      centerPx = (rect.right + window.innerWidth) / 2;
      free = window.innerWidth - rect.right;
    } else {
      centerPx = rect.left / 2;
      free = rect.left;
    }
    minFree = Math.min(minFree, free);
    const ndc = (centerPx / window.innerWidth) * 2 - 1;
    const contentNdc = ((rect.left + rect.width / 2) / window.innerWidth) * 2 - 1;
    stops.push({ x: ndc * halfWidth, contentX: contentNdc * halfWidth });
  }
  zoomScale = THREE.MathUtils.clamp((minFree * unitsPerPx * 0.85) / 1.25, 1.5, 2.6);
}

buildStops();

let currentX = stops[0].x;
let targetX = stops[0].x;
let targetContentX = stops[0].contentX;
let zoom = 0;
let zoomGoal = 0;

function updateTarget() {
  const vh = window.innerHeight;
  const sy = window.scrollY;
  let x = stops[0].x;
  let cx = stops[0].contentX;
  for (let k = 1; k < sections.length; k++) {
    const end = sections[k].offsetTop - vh * 0.25;
    const start = end - vh * 0.75;
    const p = THREE.MathUtils.smoothstep(sy, start, end);
    x += (stops[k].x - stops[k - 1].x) * p;
    cx += (stops[k].contentX - stops[k - 1].contentX) * p;
  }
  targetX = x;
  targetContentX = cx;

  const zoomStart = Math.max(0, sections[1].offsetTop - vh);
  const zoomEnd = sections[1].offsetTop - vh * 0.25;
  zoomGoal = THREE.MathUtils.smoothstep(sy, zoomStart, zoomEnd);
}

window.addEventListener('scroll', updateTarget);

let mouseX = 0;
let smoothMouseX = 0;
let lookValue = 0;

window.addEventListener('mousemove', function (e) {
  mouseX = (e.clientX / window.innerWidth) * 2 - 1;
});

window.addEventListener('resize', function () {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  buildStops();
  updateTarget();
});

renderer.setSize(window.innerWidth, window.innerHeight, false);
updateTarget();

const clock = new THREE.Clock();
let t = 0;
let blinkTimer = 2;
let blinkProgress = -1;
let lastScroll = window.scrollY;
let scrollSpeed = 0;

function animate() {
  const delta = Math.min(clock.getDelta(), 0.05);
  t = t + delta;

  const move = 1 - Math.exp(-delta * 4);
  const look = 1 - Math.exp(-delta * 5);

  currentX = currentX + (targetX - currentX) * move;
  zoom = zoom + (zoomGoal - zoom) * move;
  smoothMouseX = smoothMouseX + (mouseX - smoothMouseX) * look;

  const lookGoal = THREE.MathUtils.clamp((targetContentX - targetX) / 4, -1, 1);
  lookValue = lookValue + (lookGoal - lookValue) * (1 - Math.exp(-delta * 3));

  const speed = (window.scrollY - lastScroll) / Math.max(delta, 0.001);
  lastScroll = window.scrollY;
  scrollSpeed = scrollSpeed + (speed - scrollSpeed) * (1 - Math.exp(-delta * 8));
  const lean = THREE.MathUtils.clamp(scrollSpeed * 0.00002, -0.03, 0.03);

  const s = 1 + (zoomScale - 1) * zoom;
  const faceCamera = -Math.atan(currentX / camera.position.z);

  figure.position.x = currentX;
  figure.position.y = FEET_Y + Math.sin(t * 1.5) * 0.04;
  figure.rotation.y = faceCamera + smoothMouseX * 0.2 + lookValue * 0.3;
  figure.rotation.x = lean;
  figure.rotation.z = Math.sin(t * 0.8) * 0.015;
  figure.scale.set(s, s * (1 + Math.sin(t * 1.8) * 0.004), s);
  figure.updateMatrixWorld(true);

  const faceWorldY = FEET_Y + s * headY;
  const faceAbove = THREE.MathUtils.lerp(headY + FEET_Y + 0.15, 0.45, zoom);
  const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.position.y = faceWorldY;
  camera.setViewOffset(w, h, 0, (faceAbove / viewHeight) * h, w, h);
  camera.updateProjectionMatrix();

  poseArm(1, 'left', 0, t);
  poseArm(-1, 'right', 1.5, t);

  if (headBone && headRest && avatarModel) {
    const parentQ = new THREE.Quaternion();
    const modelQ = new THREE.Quaternion();
    headBone.parent.getWorldQuaternion(parentQ);
    avatarModel.getWorldQuaternion(modelQ);
    const axis = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(modelQ)
      .applyQuaternion(parentQ.invert())
      .normalize();
    const turn = new THREE.Quaternion().setFromAxisAngle(axis, lookValue * 0.55);
    headBone.quaternion.copy(headRest).premultiply(turn);
  }

  blinkTimer = blinkTimer - delta;
  if (blinkTimer <= 0 && blinkProgress < 0) {
    blinkProgress = 0;
  }
  if (blinkProgress >= 0) {
    blinkProgress = blinkProgress + delta / 0.18;
    if (blinkProgress >= 1) {
      blinkProgress = -1;
      blinkTimer = 2 + Math.random() * 3;
    }
  }
  let blinkValue = 0;
  if (blinkProgress >= 0) {
    blinkValue = Math.sin(blinkProgress * Math.PI);
  }

  const gazeToRight = Math.max(lookValue, 0) * 0.7;
  const gazeToLeft = Math.max(-lookValue, 0) * 0.7;
  setMorph('eyeLookOutLeft', gazeToRight);
  setMorph('eyeLookInRight', gazeToRight);
  setMorph('eyeLookInLeft', gazeToLeft);
  setMorph('eyeLookOutRight', gazeToLeft);

  setMorph('eyeBlinkRight', blinkValue);
  setMorph('eyeBlinkLeft', blinkValue);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();

const reveals = document.querySelectorAll('.reveal');
const observer = new IntersectionObserver(function (entries) {
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].isIntersecting) {
      entries[i].target.classList.add('in');
    }
  }
}, { threshold: 0.15 });

for (let i = 0; i < reveals.length; i++) {
  observer.observe(reveals[i]);
}

window.addEventListener('load', function () {
  setTimeout(function () {
    document.getElementById('preloader').classList.add('done');
  }, 1800);
});

const quoteEl = document.getElementById('quote');

if (quoteEl) {
  const quotes = [
    "Art Is The Key To Heart.",
    "Build What You Overthink.",
    "I take ideas seriously, but not always myself.",
    "Curiosity has a habit of becoming something.",
    "I’m interested in the space between things."
  ];
  let q = 0;
  quoteEl.textContent = quotes[0];

  setInterval(function () {
    quoteEl.classList.add('out');
    setTimeout(function () {
      q = q + 1;
      if (q >= quotes.length) {
        q = 0;
      }
      quoteEl.textContent = quotes[q];
      quoteEl.classList.remove('out');
    }, 500);
  }, 4000);
}