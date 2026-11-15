import { DEFAULT_PARTICLE, normalizeParticle } from './particle-config';

/** Particle reconstruction of existing images and inline SVGs. */
export function attachParticleElements(root: Document | HTMLElement = document): () => void {
  const doc = root instanceof Document ? root : root.ownerDocument;
  if (!doc.defaultView) return () => {};
  const win: Window = doc.defaultView;
  const media = win.matchMedia('(prefers-reduced-motion: reduce)'),
    mounted = new Map<HTMLElement, () => void>();
  let stopped = false;
  const style = doc.createElement('style');
  style.textContent = '[data-revyme-particle-active="true"] { opacity:0 !important; }';
  doc.head.append(style);
  function mount(el: HTMLElement) {
    if (mounted.has(el)) return;
    let active = true,
      visible = true,
      raf = 0,
      gl: WebGL2RenderingContext | null = null,
      canvas: HTMLCanvasElement | null = null,
      program: WebGLProgram | null = null,
      buffer: WebGLBuffer | null = null,
      objectUrl = '';
    let uniforms: Record<string, WebGLUniformLocation | null> = {};
    let count = 0,
      last = 0,
      builtCount = -1;
    let bounds = el.getBoundingClientRect();
    const updateBounds = () => {
      bounds = el.getBoundingClientRect();
      if (canvas) {
        canvas.style.left = bounds.left + 'px';
        canvas.style.top = bounds.top + 'px';
        canvas.style.width = bounds.width + 'px';
        canvas.style.height = bounds.height + 'px';
      }
      wake();
    };
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateBounds) : null;
    resizeObserver?.observe(el);
    const pointer = {
      x: -1e4,
      y: -1e4,
      amount: 0,
      target: 0
    };
    const read = () => {
      try {
        return normalizeParticle(JSON.parse(el.getAttribute('data-particle-object') || '')) ?? DEFAULT_PARTICLE;
      } catch {
        return DEFAULT_PARTICLE;
      }
    };
    let config = read();
    const cleanGpu = () => {
      win.cancelAnimationFrame(raf);
      raf = 0;
      el.removeAttribute('data-revyme-particle-ready');
      el.removeAttribute('data-revyme-particle-active');
      if (gl) {
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
      }
      gl = null;
      buffer = null;
      program = null;
      uniforms = {};
      canvas?.remove();
      canvas = null;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = '';
      }
    };
    let generation = 0;
    async function initialize() {
      const token = ++generation;
      cleanGpu();
      if (!active || !visible || media.matches || doc.hidden) return;
      try {
        let image: HTMLImageElement;
        if (el instanceof HTMLImageElement) {
          if (!el.complete) await new Promise<void>((resolve, reject) => {
            el.addEventListener('load', () => resolve(), {
              once: true
            });
            el.addEventListener('error', () => reject(Error('image load failed')), {
              once: true
            });
          });
          image = el;
        } else if (el instanceof SVGElement) {
          objectUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(el)], {
            type: 'image/svg+xml'
          }));
          image = new Image();
          image.src = objectUrl;
          await image.decode();
        } else return;
        if (!active || token !== generation || media.matches || !el.isConnected) return;
        const box = el.getBoundingClientRect();
        if (!box.width || !box.height || box.width * box.height > 4_000_000) return;
        const sample = doc.createElement('canvas');
        const max = 350;
        sample.width = Math.max(1, Math.round(box.width * Math.min(1, max / Math.max(box.width, box.height))));
        sample.height = Math.max(1, Math.round(box.height * Math.min(1, max / Math.max(box.width, box.height))));
        const ctx = sample.getContext('2d', {
          willReadFrequently: true
        });
        if (!ctx) return;
        const fit = win.getComputedStyle(el).objectFit,
          iw = image.naturalWidth || sample.width,
          ih = image.naturalHeight || sample.height;
        if (fit === 'cover' || fit === 'contain') {
          const scale = fit === 'cover' ? Math.max(sample.width / iw, sample.height / ih) : Math.min(sample.width / iw, sample.height / ih);
          const width = iw * scale,
            height = ih * scale;
          ctx.drawImage(image, (sample.width - width) / 2, (sample.height - height) / 2, width, height);
        } else ctx.drawImage(image, 0, 0, sample.width, sample.height);
        const pixels = ctx.getImageData(0, 0, sample.width, sample.height).data;
        const candidates: number[] = [];
        for (let i = 0; i < sample.width * sample.height; i++) if (pixels[i * 4 + 3] > 32) candidates.push(i);
        if (!candidates.length) return;
        const cfg = config;
        builtCount = cfg.count;
        count = Math.min(cfg.count, candidates.length * 2);
        const data = new Float32Array(count * 6);
        for (let i = 0; i < count; i++) {
          const index = candidates[Math.floor(Math.random() * candidates.length)],
            x = index % sample.width,
            y = Math.floor(index / sample.width),
            at = index * 4,
            j = i * 6;
          data[j] = (x + Math.random()) / sample.width;
          data[j + 1] = (y + Math.random()) / sample.height;
          data[j + 2] = pixels[at] / 255;
          data[j + 3] = pixels[at + 1] / 255;
          data[j + 4] = pixels[at + 2] / 255;
          data[j + 5] = Math.random();
        }
        canvas = doc.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.setAttribute('data-revyme-effect-overlay', '');
        canvas.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645';
        const authoredStyle = win.getComputedStyle(el);
        canvas.style.borderRadius = authoredStyle.borderRadius;
        canvas.style.opacity = authoredStyle.opacity;
        gl = canvas.getContext('webgl2', {
          alpha: true,
          premultipliedAlpha: true,
          antialias: false
        });
        if (!gl) throw Error('WebGL2 unavailable');
        const compile = (kind: number, source: string) => {
          const shader = gl!.createShader(kind);
          if (!shader) throw Error('shader allocation');
          gl!.shaderSource(shader, source);
          gl!.compileShader(shader);
          if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw Error(gl!.getShaderInfoLog(shader) || 'shader');
          return shader;
        };
        const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
          in vec2 position;in vec3 tint;in float seed;out vec3 rgb;uniform vec2 resolution,pointer;uniform float time,size,variation,radius,strength,swirl,drift,amount;
          void main(){vec2 p=position*resolution;vec2 d=p-pointer;float distance=length(d);vec2 normal=distance>.01?d/distance:vec2(0.);float field=pow(max(0.,1.-distance/max(radius,1.)),2.)*amount;vec2 tangent=vec2(-normal.y,normal.x);p+=(normal+tangent*swirl)*field*strength*radius*.45;p+=vec2(sin(time*.9+seed*37.),cos(time*.7+seed*29.))*drift;vec2 ndc=p/resolution*2.-1.;gl_Position=vec4(ndc.x,-ndc.y,0.,1.);gl_PointSize=max(1.,size*(1.-variation*.5+seed*variation));rgb=tint;}`);
        const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
          precision highp float;in vec3 rgb;out vec4 color;void main(){vec2 d=gl_PointCoord-vec2(.5);float alpha=1.-smoothstep(.35,.5,length(d));color=vec4(rgb*alpha,alpha);}`);
        program = gl.createProgram();
        if (!program) throw Error('program allocation');
        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program) || 'link');
        uniforms = Object.fromEntries(
          ['resolution', 'pointer', 'time', 'size', 'variation', 'radius', 'strength', 'swirl', 'drift', 'amount']
            .map(name => [name, gl!.getUniformLocation(program!, name)]),
        );
        buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.useProgram(program);
        for (const [name, size, offset] of [['position', 2, 0], ['tint', 3, 8], ['seed', 1, 20]] as const) {
          const location = gl.getAttribLocation(program, name);
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location, size, gl.FLOAT, false, 24, offset);
        }
        const lost = (e: Event) => {
          e.preventDefault();
          generation++;
          cleanGpu();
        };
        canvas.addEventListener('webglcontextlost', lost, {
          once: true
        });
        doc.body.append(canvas);
        updateBounds();
        el.setAttribute('data-revyme-particle-ready', 'true');
        el.setAttribute('data-revyme-particle-active', 'true');
        last = 0;
        wake();
      } catch {
        if (token === generation) cleanGpu();
      }
    }
    function frame(now: number) {
      raf = 0;
      if (!active || !visible || media.matches || doc.hidden || !gl || !program || !canvas || !el.isConnected) {
        if (media.matches || doc.hidden) el.removeAttribute('data-revyme-particle-active');
        return;
      }
      if (last && now - last < 32) {
        raf = win.requestAnimationFrame(frame);
        return;
      }
      const dt = last ? Math.min((now - last) / 1000, .05) : 0;
      last = now;
      const cfg = config,
        box = bounds,
        dpr = Math.min(win.devicePixelRatio || 1, 2, Math.sqrt(4000000 / Math.max(1, box.width * box.height)));
      const w = Math.max(1, Math.round(box.width * dpr)),
        h = Math.max(1, Math.round(box.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      pointer.amount += (pointer.target - pointer.amount) * (1 - Math.exp(-dt * cfg.spring * 6));
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const f = (n: string, v: number) => gl!.uniform1f(uniforms[n], v);
      gl.uniform2f(uniforms.resolution, w, h);
      gl.uniform2f(uniforms.pointer, pointer.x * dpr, pointer.y * dpr);
      f('time', now / 1000);
      f('size', cfg.size * dpr);
      f('variation', cfg.sizeVariance);
      f('radius', cfg.radius * dpr);
      f('strength', cfg.strength);
      f('swirl', cfg.swirl);
      f('drift', cfg.drift * dpr);
      f('amount', pointer.amount);
      gl.drawArrays(gl.POINTS, 0, count);
      if (cfg.drift > 0 || Math.abs(pointer.target - pointer.amount) > .001) raf = win.requestAnimationFrame(frame);
    }
    function wake() {
      if (active && visible && !media.matches && !doc.hidden && gl && !raf) raf = win.requestAnimationFrame(frame);
    }
    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX - bounds.left;
      pointer.y = e.clientY - bounds.top;
      pointer.target = 1;
      wake();
    };
    const onLeave = () => {
      pointer.target = 0;
      wake();
    };
    const reset = () => {
      generation++;
      cleanGpu();
      void initialize();
    };
    const observer = new MutationObserver(records => {
      config = read();
      if (records.some(r => r.attributeName === 'src' || r.attributeName === 'srcset') || config.count !== builtCount) reset();else wake();
    });
    observer.observe(el, {
      attributes: true,
      attributeFilter: ['data-particle-object', 'src', 'srcset']
    });
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? true;
      if (visible && !gl) void initialize();else if (!visible) {
        generation++;
        cleanGpu();
      }
    }) : null;
    io?.observe(el);
    el.addEventListener('pointermove', onMove, {
      passive: true
    });
    el.addEventListener('pointerleave', onLeave);
    media.addEventListener('change', reset);
    doc.addEventListener('visibilitychange', reset);
    win.addEventListener('resize', updateBounds);
    win.addEventListener('scroll', updateBounds, true);
    if (!io) void initialize();
    mounted.set(el, () => {
      active = false;
      generation++;
      cleanGpu();
      observer.disconnect();
      io?.disconnect();
      resizeObserver?.disconnect();
      win.removeEventListener('resize', updateBounds);
      win.removeEventListener('scroll', updateBounds, true);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      media.removeEventListener('change', reset);
      doc.removeEventListener('visibilitychange', reset);
    });
  }
  const scan = () => {
    if (stopped) return;
    const nodes = new Set(root.querySelectorAll<HTMLElement>('[data-canvas-effect="particle-object"]'));
    for (const [el, clean] of mounted) if (!nodes.has(el)) {
      clean();
      mounted.delete(el);
    }
    nodes.forEach(mount);
  };
  scan();
  const observer = new MutationObserver(records => { if (effectTargetsChanged(records)) scan(); });
  observer.observe(root instanceof Document ? root.documentElement : root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-canvas-effect']
  });
  return () => {
    stopped = true;
    observer.disconnect();
    mounted.forEach(clean => clean());
    mounted.clear();
    style.remove();
  };
}
import { effectTargetsChanged } from './effect-observer';
