/** V4 lighting adapter. No global RAF. Call update AFTER existing layoutDecorations().
 * Inject the same THREE namespace as the application; no bundled Three dependency.
 * Pass candles in original source order: left115, right085, left070, right135.
 */
export const LIGHT_PROFILES = Object.freeze({
  hero:    { hemisphere:.28, fill:.14, rim:.16, candle:18, range:7, count:4, exposure:1.20 },
  desktop: { hemisphere:.25, fill:.20, rim:.10, candle:12, range:5.5, count:4, exposure:1.25 },
  portrait:{ hemisphere:.32, fill:.22, rim:0, candle:7, range:4, count:2, exposure:1.25 },
  compact: { hemisphere:.36, fill:.24, rim:0, candle:4, range:3, count:2, exposure:1.20 },
});
export function chooseProfile({mode='game',width=1000,height=700,compact=false}={}) {
  return mode==='hero' ? 'hero' : compact ? 'compact' : height>width ? 'portrait' : 'desktop';
}
export function createWizardLighting({THREE,scene,renderer,candles,legacyLights=[],shadows=false}) {
  if(!Array.isArray(candles)||candles.length!==4) throw new Error('Expected four candle records in original source order');
  if(candles.some(c=>!c.wrapper||!c.visualRoot?.parent||!c.flame)) throw new Error('Attach all four visual roots and resolve flame nodes before creating lighting');
  if(scene.getObjectByName?.('WizardLightingV4')) throw new Error('Dispose the existing WizardLightingV4 before creating another');
  // Caller supplies exact legacy lights; never delete arbitrary application lights.
  const previousExposure=renderer.toneMappingExposure;
  const prior=legacyLights.map(light=>({light,visible:light.visible}));
  prior.forEach(({light})=>{light.visible=false;});
  const group=new THREE.Group();group.name='WizardLightingV4';scene.add(group);
  const hemisphere=new THREE.HemisphereLight('#acbfd5','#2c2017',0);group.add(hemisphere);
  const fill=new THREE.DirectionalLight('#c2d4eb',0);fill.position.set(0,6,2);group.add(fill);
  const rim=new THREE.DirectionalLight('#90acc8',0);rim.position.set(3,4,-5);group.add(rim);
  const points=candles.map((c,i)=>{const p=new THREE.PointLight('#ffb665',0,7,2);p.name=`CandleSource_${i}`;p.castShadow=false;p.shadow.mapSize.set(256,256);p.shadow.bias=-.0003;p.shadow.normalBias=.025;group.add(p);return p;});
  const flameShadowState=new Map();
  candles.forEach(c=>{const remember=o=>{if(!flameShadowState.has(o))flameShadowState.set(o,o.castShadow);o.castShadow=false;};remember(c.flame);c.flame.traverse?.(o=>{if(o.isMesh)remember(o);});});
  const bases=candles.map(c=>c.flame.scale.clone());
  const p=new THREE.Vector3(), scale=new THREE.Vector3();
  const previousShadow=renderer.shadowMap.enabled;
  let disposed=false;const wobbleState=[0,0,0,0];
  const effectivelyVisible=o=>{for(let n=o;n;n=n.parent){if(n.visible===false)return false;if(n===scene)return true;}return false;};
  function update({mode='game',width=1000,height=700,compact=false,lowPower=false,reducedMotion=false,paused=false,time=0}={}) {
    if(disposed)return;
    const profile=chooseProfile({mode,width,height,compact}),config=LIGHT_PROFILES[profile];
    const small=lowPower||compact||height>width||width<=600;
    hemisphere.intensity=config.hemisphere;fill.intensity=config.fill;rim.intensity=small?0:config.rim;rim.visible=rim.intensity>0;
    hemisphere.visible=hemisphere.intensity>0;fill.visible=fill.intensity>0;
    renderer.toneMappingExposure=config.exposure;
    group.updateWorldMatrix(true,false);
    const count=small?2:config.count;
    candles.forEach((c,i)=>{
      // Wrapper X/Z placement and responsive scale remain owned by the game.
      // visualRoot contains only the GLB, with a ground pivot. Keep its bottom Y=.36
      // even when its wrapper shrinks around a Y=0 origin in layoutDecorations().
      if(!c.visualRoot.parent){points[i].visible=false;points[i].intensity=0;points[i].castShadow=false;return;}
      c.visualRoot.getWorldPosition(p);p.y=.36;
      c.visualRoot.parent.worldToLocal(p);c.visualRoot.position.copy(p);
      c.visualRoot.updateWorldMatrix(true,true);
      c.flame.scale.copy(bases[i]);
      const wobble=reducedMotion?0:paused?wobbleState[i]:Math.sin(time*.001*1.7+i*1.3)*.022;
      wobbleState[i]=wobble;
      c.flame.scale.y*=1+wobble;
      c.flame.updateWorldMatrix(true,false);c.flame.getWorldPosition(p);
      // Lights belong to a scene-level group: convert, do not copy flame.local position.
      group.worldToLocal(p);points[i].position.copy(p);
      c.visualRoot.getWorldScale(scale);
      const s=Math.max(.08,Math.abs(scale.y));
      const active=i<count && effectivelyVisible(c.flame) && effectivelyVisible(c.wrapper);
      points[i].visible=active;
      // Inverse-square intensity compensation avoids hot spots when a prop shrinks.
      points[i].intensity=active?config.candle*s*s*(1+wobble*.7):0;
      points[i].distance=config.range*Math.max(.35,s);
      points[i].castShadow=Boolean(shadows&&!lowPower&&profile==='desktop'&&i===0&&active);
    });
    const shadowEnabled=previousShadow||points.some(p=>p.castShadow);
    if(renderer.shadowMap.enabled!==shadowEnabled){renderer.shadowMap.enabled=shadowEnabled;renderer.shadowMap.needsUpdate=true;}
    return {profile,pointLights:points.filter(p=>p.visible).length,shadowPointLights:points.filter(p=>p.castShadow).length,exposure:config.exposure};
  }
  function dispose(){if(disposed)return;disposed=true;scene.remove(group);points.forEach(p=>{p.shadow.map?.dispose();p.shadow.mapPass?.dispose();p.shadow.map=null;p.shadow.mapPass=null;});candles.forEach((c,i)=>{c.flame.scale.copy(bases[i]);});flameShadowState.forEach((castShadow,o)=>{o.castShadow=castShadow;});prior.forEach(({light,visible})=>{light.visible=visible;});renderer.toneMappingExposure=previousExposure;renderer.shadowMap.enabled=previousShadow;}
  return {update,dispose,group,points,hemisphere,fill,rim};
}
