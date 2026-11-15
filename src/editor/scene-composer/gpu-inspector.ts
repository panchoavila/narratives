function compile(gl:WebGL2RenderingContext,type:number,source:string){const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader)||'Shader');return shader;}
function programFor(gl:WebGL2RenderingContext,vertex:string,fragment:string){const p=gl.createProgram()!;const a=compile(gl,gl.VERTEX_SHADER,vertex),b=compile(gl,gl.FRAGMENT_SHADER,fragment);gl.attachShader(p,a);gl.attachShader(p,b);gl.linkProgram(p);gl.deleteShader(a);gl.deleteShader(b);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p)||'Program');return p;}
export function inspector(canvas:HTMLCanvasElement,disabled:boolean){
  let gl:WebGL2RenderingContext|null=null,program:WebGLProgram|null=null,buffer:WebGLBuffer|null=null,alive=true;
  const lost=(e:Event)=>{e.preventDefault();alive=false;canvas.hidden=true;};canvas.addEventListener('webglcontextlost',lost);
  try{if(disabled)throw Error('disabled');gl=canvas.getContext('webgl2');if(!gl)throw Error('unavailable');
    program=programFor(gl,`#version 300 es
    in vec3 position;uniform vec2 extent;uniform float yaw;uniform float pitch;void main(){float c=cos(yaw),s=sin(yaw);vec3 p=vec3(c*position.x+s*position.z,position.y,-s*position.x+c*position.z);p=vec3(p.x,cos(pitch)*p.y-sin(pitch)*p.z,sin(pitch)*p.y+cos(pitch)*p.z);gl_Position=vec4(p.x/extent.x,p.y/extent.y,-p.z/10000.,1.);}`,`#version 300 es
    precision highp float;uniform vec3 tint;out vec4 color;void main(){color=vec4(tint,1.);}`);
    buffer=gl.createBuffer();gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);const a=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,3,gl.FLOAT,false,0,0);
  }catch{alive=false;canvas.hidden=true;}
  return {
    render(snapshot:import('./geometry-types').Snapshot|null,active:0|1,selected:string,yaw:number,pitch=0,separation=48){if(!alive||!gl||!program||!snapshot)return;
      const box=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(box.width*dpr));canvas.height=Math.max(1,Math.round(box.height*dpr));gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.07,.12,.11,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(program);const extent=Math.max(snapshot.height/2,snapshot.width/(2*(box.width/box.height)))*1.15;gl.uniform2f(gl.getUniformLocation(program,'extent'),extent*box.width/box.height,extent);gl.uniform1f(gl.getUniformLocation(program,'yaw'),yaw*Math.PI/180);gl.uniform1f(gl.getUniformLocation(program,'pitch'),pitch*Math.PI/180);
      for(const n of snapshot.layers.filter(n=>n.scene===active)){
        const r=n.rect,x=r.x-snapshot.width/2,y=snapshot.height/2-r.y,z=n.depth*separation;const points=[x,y,z,x+r.width,y,z,x+r.width,y-r.height,z,x,y-r.height,z];
        gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(points),gl.DYNAMIC_DRAW);gl.uniform3fv(gl.getUniformLocation(program,'tint'),n.id===selected?[1,.76,.32]:[.35+n.depth*.12,.65,.53]);gl.drawArrays(gl.LINE_LOOP,0,4);
      }
    },
    destroy(){canvas.removeEventListener('webglcontextlost',lost);if(gl&&!gl.isContextLost()){gl.deleteProgram(program);gl.deleteBuffer(buffer);}alive=false;},
  };
}
