import * as THREE from 'three';

export const TABLE_FELT = Object.freeze({ halfWidth:5.175, halfDepth:3.25, y:.36 });
export const TABLE_CAMERA_ANGLE = 58;

/** Keep the model's proportions fixed. Portrait crops the side rails, not the
 * central inlay; wide screens frame the physical timber rim. */
export function frameTableCamera(camera, width, height, {compact=false}={}) {
  const portrait=height>width;
  camera.aspect=width/height;camera.fov=compact?32:43;
  const angle=THREE.MathUtils.degToRad(TABLE_CAMERA_ANGLE);
  const halfFov=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
  // Portrait reserves the lower part for the hand while retaining a circular
  // inlay in world space. Translation moves the framing, never the model.
  const targetZ=portrait?.85:compact?.32:0;
  let distance=portrait?Math.max(9.66,5.98/(2*halfFov*camera.aspect)):compact?9.2:10;
  const update=()=>{
    camera.position.set(0,distance*Math.sin(angle),targetZ+distance*Math.cos(angle));
    camera.lookAt(0,0,targetZ);camera.updateProjectionMatrix();camera.updateMatrixWorld();
  };
  update();
  if(!portrait&&!compact) {
    // Include the timber's front edge and thickness, not just the felt centre.
    for(let iteration=0;iteration<80;iteration++) {
      let fits=true;
      for(const x of [-6.5,6.5])for(const z of [-4.4,4.4])for(const y of [-.4,.36]) {
        const p=new THREE.Vector3(x,y,z).project(camera);
        if(Math.abs(p.x)>.98||Math.abs(p.y)>.90)fits=false;
      }
      if(fits)break;
      distance*=1.025;update();
    }
  }
  return {distance,targetZ,angle:TABLE_CAMERA_ANGLE};
}

/** Conservative axis-aligned card area inside the projected felt trapezoid.
 * CSS-pixel coordinates, relative to the WebGL/table viewport. */
export function projectedFeltBounds(camera,width,height) {
  const {halfWidth,halfDepth,y}=TABLE_FELT;
  const project=(x,z)=>{
    const point=new THREE.Vector3(x,y,z).project(camera);
    return {x:(point.x+1)*width/2,y:(1-point.y)*height/2};
  };
  const farLeft=project(-halfWidth,-halfDepth),farRight=project(halfWidth,-halfDepth);
  const nearLeft=project(-halfWidth,halfDepth),nearRight=project(halfWidth,halfDepth);
  return {left:Math.max(0,farLeft.x,nearLeft.x),right:Math.min(width,farRight.x,nearRight.x),
    top:Math.max(0,farLeft.y,farRight.y),bottom:Math.min(height,nearLeft.y,nearRight.y)};
}

export function tableFrameBounds(width,height,{compact=false}={}) {
  const camera=new THREE.PerspectiveCamera(43,width/height,.1,80);
  frameTableCamera(camera,width,height,{compact});
  return projectedFeltBounds(camera,width,height);
}
