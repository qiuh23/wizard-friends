import * as THREE from 'three';

// Opaque mesh bounds, not pivots or the deliberately soft candle glow sprites.
export function homePropBounds(root, camera, width, height) {
  const bounds = {left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity,worldBottom:Infinity};
  root.updateWorldMatrix(true,true);
  root.traverseVisible(mesh => {
    if (!mesh.isMesh || mesh.isSprite) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const box=mesh.geometry.boundingBox;
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]) {
      const p=new THREE.Vector3(x,y,z).applyMatrix4(mesh.matrixWorld);
      bounds.worldBottom=Math.min(bounds.worldBottom,p.y);p.project(camera);
      const px=(p.x+1)*width/2,py=(1-p.y)*height/2;
      bounds.left=Math.min(bounds.left,px);bounds.right=Math.max(bounds.right,px);
      bounds.top=Math.min(bounds.top,py);bounds.bottom=Math.max(bounds.bottom,py);
    }
  });
  return bounds;
}

// Bring the existing props onto the visible tabletop around the unchanged
// three hero cards. Never raise, zoom or offset the camera to achieve this.
export function layoutHomeTableProps(table, width, height) {
  const {camera}=table,ray=new THREE.Raycaster(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),-.36);
  const slots=[
    [table.candles[0],.13,.40,24,Math.min(74,height*.20)],
    [table.candles[1],.89,.40,24,Math.min(64,height*.18)],
    [table.candles[2],.25,.40,34,Math.min(68,height*.17)],
    [table.candles[3],.75,.40,28,Math.min(74,height*.20)],
    [table.book,.33,.72,48,Math.min(42,height*.09)],
    [table.orbStand,.73,.74,36,Math.min(66,height*.14)],
    [table.deck,.47,.67,24,Math.min(28,height*.08)],
    [table.coins,.59,.74,22,Math.min(16,height*.05)],
  ];
  for(let pass=0;pass<6;pass++) {
    // Ground all imported candles/lanterns once per pass, not once per prop.
    table.updateAssetLighting();
    let settled=true;
    for(const [group,x,y,maxWidth,maxHeight] of slots) {
      let b=homePropBounds(group,camera,width,height);
      if(!Number.isFinite(b.left)) continue;
      // The lighting adapter grounds imported candles/lanterns. Other props
      // (and the procedural fallback) must not shrink through the felt.
      if(!table.assetLighting || !table.candles.includes(group)) {
        group.position.y+=.36-b.worldBottom;
        b=homePropBounds(group,camera,width,height);
      }
      const scale=Math.min(1,maxWidth/Math.max(1,b.right-b.left),maxHeight/Math.max(1,b.bottom-b.top));
      if(scale<.999) { group.scale.multiplyScalar(scale);settled=false;continue; }
      const dx=x*width-(b.left+b.right)/2,dy=y*height-b.bottom;
      if(Math.abs(dx)+Math.abs(dy)<.1) continue;
      const origin=new THREE.Vector3(group.position.x,.36,group.position.z).project(camera);
      ray.setFromCamera(new THREE.Vector2(origin.x+dx*2/width,origin.y-dy*2/height),camera);
      const point=ray.ray.intersectPlane(plane,new THREE.Vector3());
      if(!point) continue;
      settled=false;
      group.position.x=THREE.MathUtils.clamp(point.x,-6,6);
      group.position.z=THREE.MathUtils.clamp(point.z,-3.9,3.9);
    }
    if(settled) break;
  }
  table.updateAssetLighting();
}
