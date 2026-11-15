import type { VhsConfig } from './vhs-config';

type Crop = { sx: number; sy: number; swidth: number; sheight: number };
type HtmlWebGL = WebGL2RenderingContext & {
  texElementSubImage2D?: (
    target: number, level: number, x: number, y: number, element: HTMLElement,
    options: Crop & { width: number; height: number },
  ) => void;
};

const vertex = '#version 300 es\n' + [
  'out vec2 uv;',
  'void main() {',
  '  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);',
  '  uv = vec2(p.x, 1. - p.y);',
  '  gl_Position = vec4(p * 2. - 1., 0., 1.);',
  '}',
].join('\n');

const fragment = '#version 300 es\n' + [
  'precision highp float;',
  'in vec2 uv;',
  'out vec4 pixel;',
  'uniform sampler2D surface;',
  'uniform vec2 size;',
  'uniform float time, amount;',
  'uniform vec4 transport, image;',
  'float noise(vec2 p) {',
  '  vec3 q = fract(vec3(p.xyx) * .1031);',
  '  q += dot(q, q.yzx + 33.33);',
  '  return fract((q.x + q.y) * q.z);',
  '}',
  'void main() {',
  '  float line = floor(uv.y * size.y);',
  '  float frame = floor(time * 30.);',
  '  float wave = sin(uv.y * 18. + time * 4.) * 3.4 + sin(uv.y * 44. - time * 2.) * 1.2;',
  '  float jitter = (noise(vec2(line, frame)) - .5) * 4.;',
  '  float crease = 1. - smoothstep(.005, .039, abs(uv.y - fract(.18 + time * .63)));',
  '  float head = smoothstep(.947, .99, uv.y);',
  '  float bend = wave * transport.x + jitter * transport.y + crease * jitter * 7. * transport.z',
  '    + head * (8. + jitter * 6.) * transport.w;',
  '  vec2 tap = vec2(clamp(uv.x + bend * amount / size.x, .001, .999), uv.y);',
  '  vec4 base = texture(surface, tap);',
  '  vec2 bleed = vec2(image.x * amount / size.x, 0.);',
  '  vec3 rgb = vec3(texture(surface, tap + bleed).r, base.g, texture(surface, tap - bleed * 1.4).b);',
  '  float grain = noise(floor(uv * size) + vec2(frame * 11., frame * 7.)) - .5;',
  '  float scan = .5 + .5 * cos(uv.y * size.y * 3.14159265);',
  '  float edge = dot(uv - .5, uv - .5) * 1.55;',
  '  rgb *= 1. - amount * (image.z * scan * .42 + image.w * edge);',
  '  rgb += (grain * (image.y + head * transport.w * .55 + crease * transport.z * .18)',
  '    + sin(uv.y * 12. - time * 4.) * .028) * amount * base.a;',
  '  pixel = vec4(clamp(rgb, vec3(0.), vec3(base.a)), base.a);',
  '}',
].join('\n');

/** One program and one bounded texture for the lifetime of a stage. */
export function createVhsRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false }) as HtmlWebGL | null;
  if (!gl?.texElementSubImage2D) return null;
  const program = gl.createProgram();
  const texture = gl.createTexture();
  if (!program || !texture) {
    gl.deleteProgram(program);
    gl.deleteTexture(texture);
    return null;
  }
  for (const [kind, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(kind);
    if (shader) {
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    gl.deleteTexture(texture);
    return null;
  }
  const uniforms = Object.fromEntries(
    ['size', 'time', 'amount', 'transport', 'image'].map(name => [name, gl.getUniformLocation(program, name)]),
  );
  gl.useProgram(program);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  let uploaded = false;
  return {
    upload(element: HTMLElement, crop: Crop) {
      gl.texElementSubImage2D!(gl.TEXTURE_2D, 0, 0, 0, element, {
        ...crop, width: canvas.width, height: canvas.height,
      });
      if (!uploaded && gl.getError() !== gl.NO_ERROR) throw Error('VHS drawable texture upload failed');
      uploaded = true;
    },
    draw(config: VhsConfig, cssWidth: number, cssHeight: number, seconds: number, amount: number) {
      if (!uploaded) return;
      gl.uniform2f(uniforms.size, cssWidth, cssHeight);
      gl.uniform1f(uniforms.time, seconds * config.speed);
      gl.uniform1f(uniforms.amount, amount);
      gl.uniform4f(uniforms.transport, config.wave, config.jitter, config.crease, config.switching);
      gl.uniform4f(uniforms.image, config.chroma, config.grain, config.scanlines, config.vignette);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy() {
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
    },
  };
}
