// Original procedural scene inspired by Nova's 2022 starfield. No remote assets or copied shaders.
// Loaded on demand: Three.js never enters the main editor/runtime chunk.
import {
  AdditiveBlending, BufferAttribute, Color, CylinderGeometry, DoubleSide,
  InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PerspectiveCamera,
  Scene, ShaderMaterial, SRGBColorSpace, Vector2, Vector4, WebGLRenderer,
} from 'three';
import type { NovaWarpConfig } from './nova-warp-config';

const starVertex = `
attribute vec4 seed;
uniform float travel;
uniform float intensity;
uniform float starSize;
uniform float trailLength;
uniform vec2 resolution;
varying vec2 vUv;
varying float vTint;
varying float vFade;
void main() {
  float depth = 2.0 + mod(seed.z - travel, 80.0);
  vec4 headView = modelViewMatrix * vec4(seed.xy, -depth, 1.0);
  vec4 tailView = headView + vec4(0.0, 0.0, -intensity * 5.0 * trailLength, 0.0);
  vec4 headClip = projectionMatrix * headView;
  vec4 tailClip = projectionMatrix * tailView;
  vec2 head = headClip.xy / headClip.w;
  vec2 tail = tailClip.xy / tailClip.w;
  vec2 delta = (head - tail) * resolution;
  vec2 direction = length(delta) > 0.01 ? normalize(delta) : vec2(0.0, 1.0);
  vec2 perpendicular = vec2(direction.y, -direction.x);
  float radius = starSize * (0.7 + 30.0 / depth) * (0.6 + seed.w);
  vec2 point = mix(tail, head, uv.y);
  point += (perpendicular * position.x + direction * position.y) * radius / resolution;
  gl_Position = vec4(point * headClip.w, headClip.z, headClip.w);
  vUv = uv;
  vTint = seed.w;
  vFade = (1.0 - smoothstep(60.0, 82.0, depth)) * smoothstep(2.0, 5.0, depth);
}`;
const starFragment = `
uniform vec4 colorA;
uniform vec4 colorB;
varying vec2 vUv;
varying float vTint;
varying float vFade;
void main() {
  vec2 p = abs(vUv * 2.0 - 1.0);
  float glow = exp(-p.x * p.x * 5.0) * pow(max(0.0, 1.0 - p.y * p.y), 1.5);
  vec4 color = mix(colorA, colorB, vTint);
  gl_FragColor = vec4(color.rgb, color.a * glow * vFade * 0.8);
  #include <colorspace_fragment>
}`;
const cloudVertex = `
varying vec2 vUv;
varying float vDepth;
void main() {
  vUv = uv;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}`;
const cloudFragment = `
uniform float time;
uniform float intensity;
uniform float opacity;
uniform float scale;
uniform float layer;
uniform vec4 tint;
varying vec2 vUv;
varying float vDepth;
float hash(vec3 p) { return fract(sin(dot(p, vec3(17.13, 93.71, 41.37))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x),
                 mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
                 mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float value = 0.0, weight = 0.5;
  for (int i = 0; i < 4; i++) { value += noise(p) * weight; p = p * 2.03 + 7.1; weight *= 0.5; }
  return value;
}
void main() {
  float angle = vUv.x * 6.2831853 + vUv.y * (2.0 + intensity * 0.8);
  vec3 p = vec3(cos(angle), sin(angle), vUv.y * 4.0 - time * 0.035) * scale;
  p += vec3(layer * 3.71);
  float fold = fbm(p * 1.7 + vec3(fbm(p * 0.8) * 2.0));
  float gas = smoothstep(0.28, 0.82, fold);
  float fade = (1.0 - smoothstep(35.0, 78.0, vDepth)) * smoothstep(1.0, 7.0, vDepth);
  gl_FragColor = vec4(tint.rgb, tint.a * gas * fade * opacity * (0.17 + intensity * 0.4));
  #include <colorspace_fragment>
}`;

export interface WarpFrame {
  travel: number; time: number; rotation: number; intensity: number;
  centerX: number; centerY: number; pointerX: number; pointerY: number;
}

export function createNovaWarpRenderer(canvas: HTMLCanvasElement, config: NovaWarpConfig) {
  const context = canvas.getContext('webgl2', { alpha: true, antialias: false, powerPreference: 'low-power' });
  if (!context) throw new Error('WebGL2 unavailable');
  const renderer = new WebGLRenderer({ canvas, context, alpha: true, antialias: false });
  // Background stays CSS so transparent fills and design tokens retain their normal semantics.
  renderer.setClearColor(0, 0);
  const doc = canvas.ownerDocument;
  const swatch = doc.createElement('span');
  const pixel = doc.createElement('canvas');
  pixel.width = pixel.height = 1;
  const ctx = pixel.getContext('2d');
  const color = (value: string) => {
    swatch.style.cssText = 'display:none;color:white';
    swatch.style.color = value;
    canvas.parentElement!.append(swatch);
    const resolved = doc.defaultView!.getComputedStyle(swatch).color;
    swatch.remove();
    if (!ctx) return new Vector4(1, 1, 1, 1);
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = resolved; ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    const rgb = new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
    return new Vector4(rgb.r, rgb.g, rgb.b, a / 255);
  };
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 1, 0.1, 120);
  const geometry = new InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1,-1,0, 1,-1,0, -1,1,0, 1,1,0]), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0,0, 1,0, 0,1, 1,1]), 2));
  // Stable seeds: resizing, reopening and switching breakpoints preserve the composition.
  let randomState = 7193;
  const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; };
  const seeds = new Float32Array(config.starCount * 4);
  for (let i = 0; i < config.starCount; i++) {
    const angle = random() * Math.PI * 2, radius = 2 + Math.sqrt(random()) * 24;
    seeds.set([Math.cos(angle) * radius, Math.sin(angle) * radius, random() * 80, random()], i * 4);
  }
  geometry.setAttribute('seed', new InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = config.starCount;
  const starMaterial = new ShaderMaterial({
    vertexShader: starVertex, fragmentShader: starFragment, transparent: true,
    depthWrite: false, depthTest: false, blending: AdditiveBlending,
    uniforms: {
      travel: { value: 0 }, intensity: { value: 0 }, starSize: { value: config.starSize },
      trailLength: { value: config.trailLength }, resolution: { value: new Vector2(1, 1) },
      colorA: { value: color(config.starColor) }, colorB: { value: color(config.starTint) },
    },
  });
  const stars = new Mesh(geometry, starMaterial);
  stars.frustumCulled = false;
  stars.renderOrder = 4;
  scene.add(stars);
  const cone = new CylinderGeometry(22, 0.6, 80, 64, 24, true);
  cone.rotateX(Math.PI / 2);
  cone.translate(0, 0, -42);
  const clouds = [config.cloudColor, config.cloudTint, config.cloudTint].map((tint, layer) => {
    const material = new ShaderMaterial({
      vertexShader: cloudVertex, fragmentShader: cloudFragment, transparent: true,
      side: DoubleSide, depthWrite: false, depthTest: false, blending: AdditiveBlending,
      uniforms: { time: { value: 0 }, intensity: { value: 0 }, layer: { value: layer },
        opacity: { value: config.cloudOpacity * (layer === 2 ? 0.5 : 1) },
        scale: { value: config.cloudScale * (1 + layer * 0.35) }, tint: { value: color(tint) } },
    });
    const mesh = new Mesh(cone, material);
    mesh.renderOrder = layer;
    scene.add(mesh);
    return mesh;
  });
  let width = 1, height = 1, failed = false;
  renderer.debug.onShaderError = () => { failed = true; };
  return {
    resize(w: number, h: number, dpr: number) {
      width = Math.max(1, w); height = Math.max(1, h);
      // Bound both DPR and total pixels for large editorial sections.
      renderer.setPixelRatio(Math.min(1.5, dpr, Math.sqrt(2_500_000 / (width * height))));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      starMaterial.uniforms.resolution.value.set(width, height);
    },
    render(frame: WarpFrame) {
      camera.position.set(frame.pointerX * config.parallax, -frame.pointerY * config.parallax, 0);
      camera.setViewOffset(width, height, (0.5 - frame.centerX) * width, (0.5 - frame.centerY) * height, width, height);
      starMaterial.uniforms.travel.value = frame.travel;
      starMaterial.uniforms.intensity.value = frame.intensity;
      clouds.forEach((cloud, index) => {
        cloud.rotation.z = frame.rotation * (index % 2 ? -0.7 : 1) + index * 2;
        cloud.material.uniforms.time.value = frame.time * (1 + index * 0.3);
        cloud.material.uniforms.intensity.value = frame.intensity;
      });
      renderer.render(scene, camera);
      if (failed) throw new Error('Warp shader compilation failed');
    },
    dispose() {
      geometry.dispose(); cone.dispose(); starMaterial.dispose();
      clouds.forEach(cloud => cloud.material.dispose());
      scene.clear(); renderer.dispose();
    },
  };
}
