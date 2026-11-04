/** Independent snapshot transition; no Canvas UI source, shaders or data. */
export const DISPLACEMENT_PRESET={id:'canvas.displacement.v1',duration:1.4,seed:17,columns:18,strength:.065} as const;
export function displacementEnvelope(progress:number){return progress<=0||progress>=1?0:Math.sin(Math.PI*progress);}
export function cellVector(x:number,y:number,seed:number){const angle=(x*19+y*47+seed*11)*.73;return [Math.cos(angle),Math.sin(angle)] as const;}
export async function decodeTexture(uri:string){const image=new Image();image.src=uri;await image.decode();if(!image.naturalWidth||!image.naturalHeight)throw Error('Empty snapshot');return image;}
export function createDisplacement(canvas:HTMLCanvasElement,onLost:()=>void){
  const gl=canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:true,antialias:false});if(!gl)throw Error('WebGL2 unavailable');
  const compile=(kind:number,code:string)=>{const s=gl.createShader(kind)!;gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s)||'Shader error');return s;};
  const vs=compile(gl.VERTEX_SHADER,`#version 300 es
  out vec2 uv;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`);
  const fs=compile(gl.FRAGMENT_SHADER,`#version 300 es
  precision highp float;in vec2 uv;out vec4 pixel;uniform sampler2D first;uniform sampler2D second;uniform float progress;uniform float seed;uniform float strength;uniform vec2 grid;
  void main(){float p=clamp(progress,0.,1.);float amplitude=(p<=0.||p>=1.)?0.:sin(3.14159265359*p);vec2 coord=vec2(uv.x,1.-uv.y);vec2 tile=floor(coord*grid);float angle=(tile.x*19.+tile.y*47.+seed*11.)*.73;vec2 drift=vec2(cos(angle),sin(angle))*amplitude*strength;
    vec4 a=texture(first,clamp(coord+drift*p,0.,1.));vec4 b=texture(second,clamp(coord-drift*(1.-p),0.,1.));float blend=p*p*(3.-2.*p);pixel=mix(a,b,blend);}`);
  const program=gl.createProgram()!;gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)||'Link error');
  const textures=[gl.createTexture()!,gl.createTexture()!];let ready=false,lost=false;
  const loss=(e:Event)=>{e.preventDefault();lost=true;ready=false;canvas.hidden=true;onLost();};canvas.addEventListener('webglcontextlost',loss);
  return {
    setImages(images:readonly [TexImageSource,TexImageSource]){if(lost)return;images.forEach((image,i)=>{gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,textures[i]);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);});if(gl.getError()!==gl.NO_ERROR)throw Error('Texture upload failed');ready=true;},
    render(value:number,seed=17,strength=.035,columns=18){if(!ready||lost)return;const p=Math.min(1,Math.max(0,value));const b=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);const w=Math.max(1,Math.round(b.width*dpr)),h=Math.max(1,Math.round(b.height*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}gl.viewport(0,0,w,h);gl.useProgram(program);textures.forEach((t,i)=>{gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t);});gl.uniform1i(gl.getUniformLocation(program,'first'),0);gl.uniform1i(gl.getUniformLocation(program,'second'),1);gl.uniform1f(gl.getUniformLocation(program,'progress'),p);gl.uniform1f(gl.getUniformLocation(program,'seed'),seed);gl.uniform1f(gl.getUniformLocation(program,'strength'),strength);gl.uniform2f(gl.getUniformLocation(program,'grid'),columns,Math.max(2,Math.round(columns*h/w)));gl.drawArrays(gl.TRIANGLES,0,3);},
    ready:()=>ready&&!lost,
    destroy(){canvas.removeEventListener('webglcontextlost',loss);if(!lost){textures.forEach(t=>gl.deleteTexture(t));gl.deleteProgram(program);}ready=false;},
  };
}
