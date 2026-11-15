import type { RippleConfig } from './ripple-config';

/** Refraction of a captured surface through an expanding radial wave. */
export function createRippleRenderer(canvas: HTMLCanvasElement, config: RippleConfig, origin: {
  x: number;
  y: number;
}, onLost: () => void) {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false
  });
  if (!gl) throw Error('WebGL2 unavailable');
  function compile(kind: number, source: string) {
    const shader = gl!.createShader(kind);
    if (!shader) throw Error('Shader allocation failed');
    gl!.shaderSource(shader, source);
    gl!.compileShader(shader);
    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
      const error = gl!.getShaderInfoLog(shader);
      gl!.deleteShader(shader);
      throw Error(error || 'Shader error');
    }
    return shader;
  }
  const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
    out vec2 uv; void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`);
  const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;in vec2 uv;out vec4 color;
    uniform sampler2D a,b;uniform vec2 size,origin;
    uniform float progress,amplitude,wavelength,rings,decay,refraction,dispersion,shine;
    vec4 sampleSurface(vec2 p,float mixAmount){return mix(texture(a,clamp(p,0.,1.)),texture(b,clamp(p,0.,1.)),mixAmount);}
    void main(){
      vec2 p=vec2(uv.x,1.-uv.y);vec2 relative=(p-origin)*size;float dist=length(relative);
      float maxRadius=length(size);float front=progress*(maxRadius+rings*wavelength);
      float behind=front-dist;float within=step(0.,behind)*step(behind,rings*wavelength);
      float envelope=within*exp(-decay*progress)*sin(3.14159265*clamp(behind/(rings*wavelength),0.,1.));
      float slope=cos(behind*6.2831853/wavelength)*envelope*amplitude;
      vec2 direction=dist>.01?relative/dist:vec2(0.);vec2 delta=direction*slope*refraction/size;
      float mixAmount=smoothstep(.2,.8,progress);
      vec4 base=sampleSurface(p+delta,mixAmount);
      vec4 red=sampleSurface(p+delta*(1.+dispersion*.12),mixAmount);
      vec4 blue=sampleSurface(p+delta*(1.-dispersion*.12),mixAmount);
      vec3 rgb=vec3(red.r,base.g,blue.b)+max(0.,slope)*shine*.15*base.a;
      color=vec4(clamp(rgb,0.,1.),base.a);
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
  let currentOrigin = origin;
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
    ['a', 'b', 'size', 'origin', 'progress', 'amplitude', 'wavelength', 'rings', 'decay', 'refraction', 'dispersion', 'shine']
      .map(name => [name, gl.getUniformLocation(program, name)]),
  );
  let ready = false,
    lost = false;
  const loss = (e: Event) => {
    e.preventDefault();
    lost = true;
    ready = false;
    canvas.hidden = true;
    onLost();
  };
  canvas.addEventListener('webglcontextlost', loss);
  return {
    setSize,
    setConfig(next: RippleConfig, nextOrigin: { x: number; y: number }) {
      currentConfig = next;
      currentOrigin = nextOrigin;
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
      if (!dimensions) { const box = canvas.getBoundingClientRect(); setSize(box.width, box.height); }
      if (!dimensions) return;
      const { width: w, height: h, dpr } = dimensions;
      gl.viewport(0, 0, w, h);
      gl.useProgram(program);
      textureUnits.forEach((t, i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, t);
      });
      gl.uniform1i(locations.a, 0);
      gl.uniform1i(locations.b, 1);
      gl.uniform2f(locations.size, w, h);
      gl.uniform2f(locations.origin, currentOrigin.x, currentOrigin.y);
      const f = (name: string, value: number) => gl.uniform1f(locations[name], value);
      f('progress', progress);
      f('amplitude', currentConfig.amplitude);
      f('wavelength', currentConfig.wavelength * dpr);
      f('rings', currentConfig.rings);
      f('decay', currentConfig.decay);
      f('refraction', currentConfig.refraction * dpr);
      f('dispersion', currentConfig.dispersion);
      f('shine', currentConfig.shine);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    ready: () => ready && !lost,
    destroy() {
      canvas.removeEventListener('webglcontextlost', loss);
      if (!lost) {
        textures.forEach(t => gl.deleteTexture(t));
        gl.deleteProgram(program);
      }
      ready = false;
    }
  };
}
