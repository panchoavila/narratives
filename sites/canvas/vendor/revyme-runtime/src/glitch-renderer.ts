import type { GlitchConfig } from './glitch-config';

/** Snapshot shader authored for Revyme. All distances are in CSS pixels. */
export function createGlitchRenderer(canvas: HTMLCanvasElement, config: GlitchConfig, onLost: () => void) {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false
  });
  if (!gl) throw Error('WebGL2 unavailable');
  const compile = (kind: number, source: string) => {
    const shader = gl.createShader(kind);
    if (!shader) throw Error('Shader allocation failed');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw Error(error || 'Shader error');
    }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
    out vec2 uv;
    void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`);
  const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    in vec2 uv; out vec4 color;
    uniform sampler2D a; uniform sampler2D b;
    uniform float progress, frame, amount, slices, shift, rgb, blocks, noise;
    uniform vec2 size;
    float rand(vec2 p){return fract(sin(dot(p,vec2(41.13,289.73)))*18347.731);}
    vec4 samplePage(vec2 p, float mixAmount){return mix(texture(a,clamp(p,0.,1.)),texture(b,clamp(p,0.,1.)),mixAmount);}
    void main(){
      vec2 p=vec2(uv.x,1.-uv.y); float phase=clamp(progress,0.,1.);
      float envelope=sin(phase*3.14159265)*amount;
      float band=floor(p.y*slices); float chance=rand(vec2(band,frame));
      float jump=(rand(vec2(band+9.,frame+7.))-.5)*2.;
      p.x+=step(.72,chance)*jump*shift*envelope/size.x;
      vec2 cell=floor(p*vec2(16.,slices*.65));
      float corrupt=step(1.-.16*blocks,rand(cell+frame));
      p+=corrupt*vec2(rand(cell+frame+3.)-.5,rand(cell+frame+7.)-.5)*vec2(.08,.025)*envelope;
      float split=rgb*envelope/size.x;
      vec4 c=samplePage(p,phase); vec4 left=samplePage(p+vec2(split,0.),phase); vec4 right=samplePage(p-vec2(split,0.),phase);
      vec3 chroma=vec3(left.r,c.g,right.b);
      float grain=(rand(floor(uv*size)+frame)-.5)*noise*envelope*.2;
      color=vec4(clamp(chroma+grain*c.a,0.,1.),c.a);
    }`);
  const program = gl.createProgram();
  if (!program) throw Error('Program allocation failed');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const error = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw Error(error || 'Link error');
  }
  const textures = [gl.createTexture(), gl.createTexture()];
  if (!textures[0] || !textures[1]) throw Error('Texture allocation failed');
  let currentConfig = config;
  const uploaded: (TexImageSource | null)[] = [null, null];
  let textureUnits = [textures[0], textures[1]];
  let dimensions: { width: number; height: number; dpr: number } | null = null;
  const maxDimension = Math.min(8192, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number);
  function setSize(cssWidth: number, cssHeight: number) {
    if (cssWidth <= 0 || cssHeight <= 0) return;
    const dpr = Math.min(devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / (cssWidth * cssHeight)), maxDimension / Math.max(cssWidth, cssHeight));
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    dimensions = { width, height, dpr };
  }
  const locations = Object.fromEntries(
    ['a', 'b', 'progress', 'frame', 'amount', 'slices', 'shift', 'rgb', 'blocks', 'noise', 'size']
      .map(name => [name, gl.getUniformLocation(program, name)]),
  );
  let ready = false,
    lost = false;
  const loss = (event: Event) => {
    event.preventDefault();
    lost = true;
    ready = false;
    canvas.hidden = true;
    onLost();
  };
  canvas.addEventListener('webglcontextlost', loss);
  return {
    setSize,
    setConfig(next: GlitchConfig) {
      currentConfig = next;
    },
    setImages(images: readonly [TexImageSource, TexImageSource]) {
      if (lost) return;
      textureUnits = images[0] === images[1] ? [textures[0], textures[0]] : [textures[0], textures[1]];
      images.forEach((image, i) => {
        if (i === 1 && images[0] === images[1]) return;
        if (uploaded[i] === image) return;
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, textures[i]);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        uploaded[i] = image;
      });
      if (gl.getError() !== gl.NO_ERROR) throw Error('Texture upload failed');
      ready = true;
    },
    render(progress: number, _seed?: number, _strength?: number, _columns?: number) {
      if (!ready || lost) return;
      if (!dimensions) { const rect = canvas.getBoundingClientRect(); setSize(rect.width, rect.height); }
      if (!dimensions) return;
      const { width, height, dpr } = dimensions;
      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      textureUnits.forEach((texture, i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, texture);
      });
      const f = (name: string, value: number) => gl.uniform1f(locations[name], value);
      gl.uniform1i(locations.a, 0);
      gl.uniform1i(locations.b, 1);
      f('progress', progress);
      f('frame', Math.floor(performance.now() / 42));
      f('amount', currentConfig.intensity);
      f('slices', currentConfig.slices);
      f('shift', currentConfig.shift * dpr);
      f('rgb', currentConfig.rgbShift * dpr);
      f('blocks', currentConfig.blocks);
      f('noise', currentConfig.noise);
      gl.uniform2f(locations.size, width, height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    ready: () => ready && !lost,
    destroy() {
      canvas.removeEventListener('webglcontextlost', loss);
      if (!lost) {
        textures.forEach(texture => gl.deleteTexture(texture));
        gl.deleteProgram(program);
      }
      ready = false;
    }
  };
}
