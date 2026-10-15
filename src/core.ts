import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { DEFAULTS, SLOW, type Settings } from "./settings";

/**
 * Shutter: a drone filmed by a phone. A phone's sensor doesn't take a frame all at once: it reads one row at a time,
 * top to bottom, so a row lower down is read a few milliseconds after the one above it. The body of the drone hardly
 * moves in that time; its propellers turn a long way. Every row catches the blades where they were when it was read,
 * so the recorded blades bend, split and float free of their hubs, and at some speeds they stand still.
 *
 * Nothing here fakes the look. The rest of the drone is drawn as usual; each rotor is a flat disc that works out, per
 * pixel, when its row was read, and where the blades were at that moment (the blades are baked once, seen along the
 * rotor's axis, into a picture of their colour and their normals). The shutter stays open for the exposure, so each
 * pixel averages the blades over that window too: a short shutter gives crisp bent blades, a long one a blur.
 * The settings are in settings.ts.
 */
export { DEFAULTS, SLOW, type Settings };

export type ShutterOptions = {
  canvas: HTMLCanvasElement;
  /** Terne X (terne.glb) or any model whose rotors are nodes named TX_motor_* holding blades named TX_blade_*. */
  model: string;
  /** Where DRACOLoader finds its decoder. */
  draco: string;
  pixelRatio?: number;
  /** Motion off: time stands still; a change of settings takes a new photo. */
  still?: boolean;
  settings?: Partial<Settings>;
  /** Where the drone sits, from the canvas's size: a box in -1..1 across and up that its outline is fitted into. */
  region?: (width: number, height: number) => Region;
  /** Materials by the model's material names, in place of the plain ones here. */
  materials?: Record<string, THREE.Material>;
  /** After the model loads and before anything is drawn (to lay an AO map over it, say). */
  onModel?: (root: THREE.Object3D, renderer: THREE.WebGLRenderer) => void;
  onReady?: () => void;
  onFail?: (reason: unknown) => void;
  /** After each frame is drawn, with the frame time the loop means to hold (ms): in real time a new frame comes only
   *  as often as the camera records one. */
  onFrame?: (now: number, target: number) => void;
  /** Slow motion: how far down the frame the readout has got (0 top, 1 bottom), or null when it doesn't show. */
  onLine?: (row: number | null) => void;
  /** The rotors' actual speed as they spool towards the setting. */
  onSpin?: (rpm: number) => void;
};
export type Shutter = {
  renderer: THREE.WebGLRenderer;
  settings: Settings;
  set: (s: Partial<Settings>) => void;
  setStill: (on: boolean) => void;
  setPixelRatio: (dpr: number) => void;
  /** Fit the drone to its region again (after the page's layout changes). */
  refit: () => void;
  dispose: () => void;
};

const lin = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
const TAU = Math.PI * 2;

// The sky over a phone pointed up: a pale overcast, brighter towards the horizon, with a little cloud.
const SKY = { zenith: lin(0.42, 0.5, 0.58), horizon: lin(0.83, 0.86, 0.88), ground: lin(0.085, 0.09, 0.08), cloud: lin(0.93, 0.94, 0.95) };
const SUN = new THREE.Vector3(-0.35, 1, 0.45).normalize();
const REST_YAW = 0.3;
export type Region = { x0: number; x1: number; y0: number; y1: number };
const DEFAULT_REGION = (w: number, h: number): Region => h > w ? { x0: -0.86, x1: 0.86, y0: -0.5, y1: 0.5 } : { x0: -0.6, x1: 0.6, y0: -0.78, y1: 0.78 };

/** Plain materials for terne.glb by its Blender material names (the portfolio passes the case's own). */
function plainMaterials(): Record<string, THREE.Material> {
  const std = (c: THREE.Color, metalness: number, roughness: number) => new THREE.MeshStandardMaterial({ color: c, metalness, roughness });
  const glow = (c: THREE.Color, e: THREE.Color, i: number) => new THREE.MeshStandardMaterial({ color: c, emissive: e, emissiveIntensity: i });
  const dark = std(lin(0.04, 0.042, 0.045), 0.6, 0.42);
  return {
    TX_shell: std(lin(0.4, 0.405, 0.41), 1, 0.44), TX_titanium: std(lin(0.66, 0.64, 0.6), 1, 0.26), TX_hull: dark,
    TX_ball: new THREE.MeshPhysicalMaterial({ color: lin(0.8, 0.8, 0.78), roughness: 0.34, clearcoat: 0.16 }),
    TX_camera: new THREE.MeshPhysicalMaterial({ color: lin(0.028, 0.029, 0.031), roughness: 0.34, clearcoat: 0.3 }),
    TX_prop: new THREE.MeshPhysicalMaterial({ color: lin(0.035, 0.036, 0.038), roughness: 0.4, clearcoat: 0.25 }),
    TX_accent: new THREE.MeshPhysicalMaterial({ color: lin(0.62, 0.035, 0.03), roughness: 0.44, clearcoat: 0.25 }),
    TX_bell: std(lin(0.07, 0.072, 0.076), 1, 0.3), TX_metal_dark: std(lin(0.16, 0.162, 0.168), 1, 0.32), TX_hub: std(lin(0.03, 0.031, 0.033), 0, 0.45),
    TX_rubber: std(lin(0.018, 0.018, 0.019), 0, 0.85), TX_grip: std(lin(0.04, 0.041, 0.043), 0, 0.75), TX_vent: std(lin(0.008, 0.008, 0.009), 0, 0.8),
    TX_copper: std(lin(0.93, 0.52, 0.32), 1, 0.36), TX_stator: std(lin(0.02, 0.02, 0.022), 0, 0.5),
    TX_light: std(lin(0.55, 0.56, 0.57), 0, 0.25), TX_print_dark: std(lin(0.16, 0.162, 0.168), 0, 0.46), TX_print_light: std(lin(0.62, 0.62, 0.61), 0, 0.5),
    TX_led_red: glow(lin(0.25, 0.02, 0.02), lin(1, 0.06, 0.03), 3), TX_led_green: glow(lin(0.02, 0.2, 0.05), lin(0.15, 1, 0.35), 2.5),
    TX_led_white: glow(lin(0.3, 0.3, 0.3), lin(0.85, 0.95, 1), 1.6),
    TX_visor: new THREE.MeshPhysicalMaterial({ color: lin(0.006, 0.006, 0.007), roughness: 0.05, clearcoat: 1 }),
    TX_chamfer: std(lin(0.9, 0.91, 0.92), 1, 0.09), TX_lens_plate: std(lin(0.03, 0.032, 0.035), 0.9, 0.26),
    default: dark,
  };
}

// The sky, as a dome: the background and (prefiltered) what the metal reflects.
const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = /* glsl */`
uniform vec3 uZenith, uHorizon, uGround, uCloud;
uniform float uTime, uClouds;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  vec3 c = mix(uHorizon, uZenith, pow(clamp(d.y, 0.0, 1.0), 0.7));
  // a soft overcast drifting overhead: the cloud base is a plane, so it thins and flattens towards the horizon
  if (d.y > 0.0 && uClouds > 0.0) {
    vec2 p = d.xz / (d.y + 0.08) * 0.9 + vec2(uTime * 0.004, uTime * 0.0015);
    float k = smoothstep(0.42, 0.78, fbm(p)) * smoothstep(0.0, 0.35, d.y);
    c = mix(c, uCloud, k * 0.55 * uClouds);
  }
  c = mix(c, uGround, smoothstep(0.02, -0.08, d.y));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// A rotor as the sensor records it. vLocal is the point on the rotor's plane in the motor's own space.
const ROTOR_VERT = /* glsl */`
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
  vLocal = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const ROTOR_FRAG = /* glsl */`
uniform sampler2D uAlbedo, uNormal;
uniform mat4 uBake;        // motor space -> the bake camera's clip space
uniform mat3 uBakeRot;     // the bake camera's view space -> motor space
uniform mat3 uWorldRot;    // motor space -> world
uniform float uTheta;      // the rotor's angle when the first row of this frame was read (radians, signed)
uniform float uOmega;      // its speed (radians a second, signed)
uniform float uReadout, uExposure, uFrame, uLine, uRadius, uHeight, uTexSize;
uniform vec2 uRes;
uniform vec3 uSun, uSunColor, uZenith, uHorizon, uGround, uCam;
varying vec3 vLocal;
varying vec3 vWorld;

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 sky(vec3 d) { return d.y > 0.0 ? mix(uHorizon, uZenith, pow(d.y, 0.7)) : mix(uHorizon, uGround, smoothstep(0.0, -0.1, d.y)); }

void main() {
  if (length(vLocal.xz) > uRadius) discard;
  // Rows are read top to bottom; each collects light for the exposure and is read as it closes.
  float row = 1.0 - gl_FragCoord.y / uRes.y;
  float t0 = row * uReadout - uExposure;
  if (row > uLine) t0 -= uFrame;           // slow motion: rows the readout hasn't reached yet still hold the last frame
  int n = int(clamp(ceil(abs(uOmega) * uExposure / 0.012), 2.0, 48.0));
  float j = ign(gl_FragCoord.xy);
  // The texture's level of detail from how much of the rotor one pixel covers (turning the lookup inside the loop would
  // otherwise read as a huge gradient, and the loop's branches leave the hardware's own derivatives undefined).
  vec2 dx = dFdx(vLocal.xz), dy = dFdy(vLocal.xz);
  float lod = log2(max(max(length(dx), length(dy)) / (2.0 * uRadius) * uTexSize, 1.0));
  vec3 V = normalize(uCam - vWorld);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 48; i++) {
    if (i >= n) break;
    float a = uTheta + uOmega * (t0 + (float(i) + j) / float(n) * uExposure);
    float c = cos(a), s = sin(a);
    // the point of the resting blades that is here once the rotor has turned by a
    vec3 q = vec3(c * vLocal.x - s * vLocal.z, uHeight, s * vLocal.x + c * vLocal.z);
    vec2 uv = (uBake * vec4(q, 1.0)).xy * 0.5 + 0.5;
    vec4 alb = textureLod(uAlbedo, uv, lod);
    if (alb.a < 0.004) continue;
    vec4 nr = textureLod(uNormal, uv, lod);
    vec3 nl = uBakeRot * normalize(nr.rgb / max(nr.a, 1e-3) * 2.0 - 1.0);
    vec3 N = normalize(uWorldRot * vec3(c * nl.x + s * nl.z, nl.y, -s * nl.x + c * nl.z));
    if (dot(N, V) < 0.0) N = -N;
    vec3 albedo = alb.rgb / alb.a;
    float diff = max(dot(N, uSun), 0.0);
    vec3 H = normalize(uSun + V);
    float coat = pow(max(dot(N, H), 0.0), 60.0) * 0.6 * diff;
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 col = albedo * (mix(uGround, uZenith, N.y * 0.5 + 0.5) * 0.9 + uSunColor * diff) + uSunColor * coat + sky(reflect(-V, N)) * fres * 0.3;
    acc += vec4(col, 1.0) * alb.a;
  }
  acc /= float(n);
  if (acc.a < 0.002) discard;
  gl_FragColor = vec4(acc.rgb / acc.a, acc.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb *= gl_FragColor.a;
}`;

type Rotor = {
  node: THREE.Object3D; dir: number; disc: THREE.Mesh; mat: THREE.ShaderMaterial;
  albedo: THREE.WebGLRenderTarget; normal: THREE.WebGLRenderTarget; blades: THREE.Object3D[];
  truth: THREE.Group;        // the blades as they actually are, drawn as outlines in slow motion
};

export function createShutter(o: ShutterOptions): Shutter {
  const { canvas } = o;
  const settings: Settings = { ...DEFAULTS, ...o.settings };
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(o.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.02, 60);
  let alive = true, ready = false, still = !!o.still, dirty = true, raf = 0, prev = 0;

  // ------------------------------------------------------------------------------------------ sky and light
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
    uniforms: { uZenith: { value: SKY.zenith }, uHorizon: { value: SKY.horizon }, uGround: { value: SKY.ground }, uCloud: { value: SKY.cloud }, uTime: { value: 0 }, uClouds: { value: 1 } },
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), skyMat);
  dome.renderOrder = -1;
  scene.add(dome);
  // what the metal reflects: the same sky without the cloud, prefiltered
  const envScene = new THREE.Scene();
  const envSky = skyMat.clone();
  envSky.uniforms.uClouds.value = 0;
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envSky));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
  envSky.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.9;
  const sun = new THREE.DirectionalLight(0xfff4e6, 1.6);
  sun.position.copy(SUN).multiplyScalar(5);
  const bounce = new THREE.HemisphereLight(SKY.zenith, SKY.ground, 0.35);
  scene.add(sun, bounce);

  // ------------------------------------------------------------------------------------------ the drone
  const drone = new THREE.Group();
  drone.rotation.order = "YXZ";
  scene.add(drone);
  const rotors: Rotor[] = [];
  const size = new THREE.Vector3();
  const res = new THREE.Vector2();
  const draco = new DRACOLoader().setDecoderPath(o.draco);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const mats = { ...plainMaterials(), ...o.materials };

  loader.load(o.model, gltf => {
    if (!alive) return;
    const root = gltf.scene;
    root.traverse(n => {
      const mesh = n as THREE.Mesh;
      if (mesh.isMesh) mesh.material = mats[(mesh.material as THREE.Material).name] ?? mats.default;
    });
    // centre it on the origin
    const box = new THREE.Box3().setFromObject(root);
    root.position.sub(box.getCenter(new THREE.Vector3()));
    box.getSize(size);
    drone.add(root);
    o.onModel?.(root, renderer);
    drone.updateMatrixWorld(true);
    root.traverse(n => { if (/^TX_motor_/.test(n.name)) rotors.push(makeRotor(n)); });
    // the outline the framing fits: every eighth vertex of the body, and the rotors' circles
    const inv = new THREE.Matrix4().copy(drone.matrixWorld).invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
    root.traverse(n => {
      const mesh = n as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible || mesh.parent?.name.startsWith("TX_blade_") || rotors.some(r => r.disc === mesh)) return;
      m.multiplyMatrices(inv, mesh.matrixWorld);
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 8) outline.push(v.fromBufferAttribute(pos, i).applyMatrix4(m).clone());
    });
    for (const r of rotors) for (let i = 0; i < 32; i++) {
      const a = i / 32 * TAU, R = r.mat.uniforms.uRadius.value as number;
      outline.push(new THREE.Vector3(Math.cos(a) * R, r.mat.uniforms.uHeight.value as number, Math.sin(a) * R).applyMatrix4(r.node.matrixWorld).applyMatrix4(inv));
    }
    resize();
    renderer.compileAsync(scene, camera).catch(() => {}).finally(() => {
      if (!alive) return;
      ready = true; dirty = true;
      o.onReady?.();
      kick();
    });
  }, undefined, err => { if (alive) o.onFail?.(err); });

  /** A rotor's blades baked along its axis (colour and normals), and the disc that draws them as the sensor sees them. */
  function makeRotor(node: THREE.Object3D): Rotor {
    const dir = Number(node.userData.spin ?? 1) >= 0 ? 1 : -1;
    const blades = node.children.filter(c => c.name.startsWith("TX_blade_"));
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    // the blades in the motor's space: how far they reach, and between what heights
    const bake = new THREE.Scene();
    const v = new THREE.Vector3();
    let radius = 0, lo = Infinity, hi = -Infinity;
    const truth = new THREE.Group();
    const outline = new THREE.LineBasicMaterial({ color: 0x16181b, transparent: true, opacity: 0.4, depthTest: false });
    for (const blade of blades) blade.traverse(n => {
      const mesh = n as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        radius = Math.max(radius, Math.hypot(v.x, v.z));
        lo = Math.min(lo, v.y); hi = Math.max(hi, v.y);
      }
      const copy = new THREE.Mesh(mesh.geometry, mesh.material);
      copy.matrixAutoUpdate = false;
      copy.matrix.copy(m);
      bake.add(copy);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 28), outline);
      edges.matrixAutoUpdate = false;
      edges.matrix.copy(m);
      edges.renderOrder = 3;
      truth.add(edges);
    });
    radius *= 1.01;
    // looking up the axis from below, as the phone does
    const cam = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.001, hi - lo + 0.02);
    cam.position.set(0, lo - 0.01, 0);
    cam.up.set(0, 0, 1);
    cam.lookAt(0, hi, 0);
    cam.updateMatrixWorld(true);
    const S = window.matchMedia("(max-width: 700px)").matches ? 512 : 1024;
    const target = () => new THREE.WebGLRenderTarget(S, S, {
      type: THREE.HalfFloatType, samples: 4, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
    });
    const albedo = target(), normal = target();
    const flat = new Map<THREE.Material, THREE.Material>();
    const nm = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
    const clear = renderer.getClearColor(new THREE.Color()), clearA = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    bake.traverse(n => {
      const mesh = n as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.MeshStandardMaterial;
      if (!flat.has(src)) flat.set(src, new THREE.MeshBasicMaterial({ color: src.color ?? 0x101010, side: THREE.DoubleSide }));
      mesh.material = flat.get(src)!;
    });
    renderer.setRenderTarget(albedo); renderer.clear(); renderer.render(bake, cam);
    bake.overrideMaterial = nm;
    renderer.setRenderTarget(normal); renderer.clear(); renderer.render(bake, cam);
    renderer.setRenderTarget(null);
    renderer.setClearColor(clear, clearA);
    for (const m of flat.values()) m.dispose();
    nm.dispose();
    for (const blade of blades) blade.visible = false;

    const mat = new THREE.ShaderMaterial({
      vertexShader: ROTOR_VERT, fragmentShader: ROTOR_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        uAlbedo: { value: albedo.texture }, uNormal: { value: normal.texture },
        uBake: { value: new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse) },
        uBakeRot: { value: new THREE.Matrix3().setFromMatrix4(cam.matrixWorld) },
        uWorldRot: { value: new THREE.Matrix3() },
        uTheta: { value: 0 }, uOmega: { value: 0 }, uReadout: { value: 0 }, uExposure: { value: 0 }, uFrame: { value: 0 }, uLine: { value: 2 },
        uRadius: { value: radius }, uHeight: { value: (lo + hi) / 2 }, uTexSize: { value: S }, uRes: { value: res },
        uSun: { value: SUN }, uSunColor: { value: lin(1.45, 1.38, 1.3) }, uZenith: { value: SKY.zenith }, uHorizon: { value: SKY.horizon },
        uGround: { value: SKY.ground }, uCam: { value: camera.position },
      },
    });
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2).translate(0, (lo + hi) / 2, 0), mat);
    disc.renderOrder = 2;
    disc.frustumCulled = false;
    node.add(disc);
    truth.visible = false;
    node.add(truth);
    return { node, dir, disc, mat, albedo, normal, blades, truth };
  }

  // ------------------------------------------------------------------------------------------ framing
  // The phone is below the drone and a little in front, looking up at it. The drone is fitted into the part of the
  // frame the page leaves it (region, in -1..1 across and up), by its actual outline: the body and the circles the
  // rotors sweep.
  const outline: THREE.Vector3[] = [];
  const rest = new THREE.Matrix4().makeRotationY(REST_YAW);
  const p = new THREE.Vector3();
  function frame() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    camera.aspect = w / h;
    camera.fov = h > w ? 36 : 28;
    const r = (o.region ?? DEFAULT_REGION)(w, h);
    const el = THREE.MathUtils.degToRad(-58), az = THREE.MathUtils.degToRad(24);
    const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    camera.clearViewOffset();
    let d = 1, cx = 0, cy = 0;
    for (let pass = 0; pass < 3 && outline.length; pass++) {
      camera.position.copy(dir).multiplyScalar(d);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const q of outline) {
        p.copy(q).applyMatrix4(rest).project(camera);
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
      d *= Math.max((x1 - x0) / (r.x1 - r.x0), (y1 - y0) / (r.y1 - r.y0));
      cx = (x0 + x1) / 2; cy = (y0 + y1) / 2;
    }
    camera.position.copy(dir).multiplyScalar(outline.length ? d : 1.4);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    if (outline.length) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const q of outline) {
        p.copy(q).applyMatrix4(rest).project(camera);
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
      cx = (x0 + x1) / 2; cy = (y0 + y1) / 2;
      // slide the view so the outline's centre lands on the region's (half the NDC difference, in pixels)
      camera.setViewOffset(w, h, (cx - (r.x0 + r.x1) / 2) * w / 2, -(cy - (r.y0 + r.y1) / 2) * h / 2, w, h);
      camera.updateProjectionMatrix();
    }
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.getDrawingBufferSize(res);
    frame();
    dirty = true;
  }
  const ro = new ResizeObserver(() => { resize(); kick(); });
  // a lost context takes the bakes with it: stop, and let the page show its still
  const lost = () => { if (!alive) return; alive = false; cancelAnimationFrame(raf); o.onFail?.(new Error("WebGL context lost")); };
  canvas.addEventListener("webglcontextlost", lost);
  ro.observe(canvas);
  resize();

  // ------------------------------------------------------------------------------------------ time
  // T is the scene's own time (it runs SLOW times as fast in slow motion). The rotors spool towards the set speed.
  let T = 0, spin = settings.rpm, phase = 0, shown = -1, drawn = 0;
  const hover = (t: number) => {
    drone.position.set(Math.sin(t * 0.37) * 0.006, Math.sin(t * 0.83) * 0.008, Math.sin(t * 0.29 + 1) * 0.005);
    drone.rotation.set(Math.sin(t * 0.41) * 0.012, REST_YAW + Math.sin(t * 0.19) * 0.02, Math.sin(t * 0.53 + 2) * 0.012);
  };

  function draw(now: number) {
    raf = 0;
    if (!alive) return;
    const dt = prev ? Math.min(0.1, (now - prev) / 1000) : 0;
    prev = now;
    const rate = still ? 0 : settings.slow ? SLOW : 1;
    const step = dt * rate;
    // spool: a motor reaches a new speed in about a fifth of a second
    const before = spin;
    spin += (settings.rpm - spin) * (1 - Math.exp(-step / 0.07));
    if (still) spin = settings.rpm;
    if (Math.abs(spin - before) > 0.5) o.onSpin?.(spin);
    phase = (phase + spin / 60 * TAU * step) % TAU;
    T += step;
    const F = 1 / settings.fps;
    const readout = Math.min(settings.readout, F);
    const k = Math.floor(T / F), tk = k * F;
    // in real time the screen shows the last frame the camera recorded: draw only when there is a new one
    const line = settings.slow && !still && readout > 0 ? Math.min(1, (T - tk) / readout) : null;
    // slow motion draws every frame, at 60 fps at most (a 120 Hz screen gets every other one)
    if (ready && (dirty || k !== shown || (line !== null && now - drawn > 1000 / 60 - 4))) {
      dirty = false;
      shown = k;
      drawn = now;
      hover(tk);
      skyMat.uniforms.uTime.value = tk;
      drone.updateMatrixWorld(true);
      const omega = spin / 60 * TAU;
      const phaseAtFrame = phase - omega * (T - tk);
      const wr = new THREE.Matrix4();
      for (const r of rotors) {
        const u = r.mat.uniforms;
        u.uTheta.value = (r.dir * phaseAtFrame) % TAU;
        u.uOmega.value = r.dir * omega;
        u.uReadout.value = readout;
        u.uExposure.value = Math.min(settings.exposure, F);
        u.uFrame.value = F;
        u.uLine.value = line ?? 2;
        u.uWorldRot.value.setFromMatrix4(wr.extractRotation(r.node.matrixWorld));
        r.truth.visible = line !== null;
        if (line !== null) r.truth.rotation.y = r.dir * phase;
      }
      renderer.render(scene, camera);
      o.onLine?.(line);
      o.onFrame?.(now, line !== null ? 1000 / 60 : 1000 * F);
    }
    if (!still && ready) raf = requestAnimationFrame(draw);
  }
  function kick() { if (!raf && alive) raf = requestAnimationFrame(draw); }
  const onVisible = () => { prev = 0; if (!document.hidden) kick(); };
  document.addEventListener("visibilitychange", onVisible);

  return {
    renderer,
    settings,
    set(s) {
      Object.assign(settings, s);
      dirty = true;
      kick();
    },
    setStill(on) { still = on; dirty = true; prev = 0; kick(); },
    setPixelRatio(dpr) { renderer.setPixelRatio(dpr); resize(); kick(); },
    refit() { resize(); kick(); },
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("webglcontextlost", lost);
      document.removeEventListener("visibilitychange", onVisible);
      for (const r of rotors) { r.albedo.dispose(); r.normal.dispose(); r.mat.dispose(); r.disc.geometry.dispose(); }
      scene.traverse(n => { const m = n as THREE.Mesh; if (m.isMesh || (n as THREE.LineSegments).isLineSegments) m.geometry?.dispose(); });
      env.dispose();
      skyMat.dispose();
      draco.dispose();
      renderer.dispose();
    },
  };
}
