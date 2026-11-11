// Local browser regression, loaded by `playwright-cli run-code --filename`.
// Uses the production entry and legal engine actions. Test references are
// injected into responses; no fixture or inspection API ships to production.
async page => {
  const base = 'http://127.0.0.1:5175/';
  const out = 'output/playwright/table-play';
  const checks = [], errors = [], screenshots = [];
  const assert = (value, message) => { if (!value) throw Error(message); };
  const overlap = (a,b) => a.left < b.right-1 && a.right > b.left+1 && a.top < b.bottom-1 && a.bottom > b.top+1;
  const fixtures = await page.evaluate(async () => {
    const {createGame,addPlayer,act,viewFor,winner}=await import('/src/game.js');
    const {DEFAULT_OPTIONS}=await import('/src/rules-options.js');
    const {createRandomStream}=await import('/src/random.js');
    const records={};
    for(const count of [3,4,5,6])for(const stage of ['full','action']) {
      const game=createGame();game.randomState=createRandomStream(Array(11).fill(14));
      for(let i=0;i<count;i++)addPlayer(game,`p${i}`,['青岚','云舒','风行','清月','星河','林语'][i]);
      act(game,'p0',{type:'start',options:DEFAULT_OPTIONS});
      for(let i=0;i<20000;i++) {
        if(game.round>=6&&game.phase==='play'&&(stage==='full'?game.trick.length===0:game.turn===0&&game.trick.length>0))break;
        const p=game.players[game.turn],v=viewFor(game,p.id);
        const action=game.phase==='trump'?{type:'trump',suit:'blue'}:game.phase==='bid'?{type:'bid',value:v.bids[0]}:game.phase==='play'?{type:'play',card:v.legal[0]}:{type:'next'};
        act(game,['trickEnd','roundEnd'].includes(game.phase)?'p0':p.id,action);
      }
      if(stage==='full')for(let i=0;i<count;i++){const p=game.players[game.turn];act(game,p.id,{type:'play',card:viewFor(game,p.id).legal[0]});}
      game.players.forEach(p=>p.bot=false);
      records[`${count}-${stage}`]={version:1,role:'practice',room:'离线练习',me:'p0',game,identities:{},expected:winner(game.trick,game.trump,game.options.deckMode)};
    }
    return records;
  });
  const browser = page.context().browser();
  async function open(width,height,record,webgl=true,reducedMotion='no-preference') {
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,hasTouch:width<1000,isMobile:width<600,reducedMotion});
    await context.addInitScript(({record,webgl})=>{
      const anchor=Date.now();Date.now=()=>anchor;
      record.game.turnDeadline=anchor+45000;record.remainingMs=45000;
      record.collection={scope:`${record.game.round}:${record.game.completedTricks}`,at:anchor+3000,remainingMs:null};
      record.game.events.forEach(e=>{e.time=anchor-(e.type==='trickEnd'?0:1000);});
      if(!sessionStorage.getItem('table-play-review-loaded')) {
        sessionStorage.setItem('wizard-room-session',JSON.stringify(record));
        sessionStorage.setItem('table-play-review-loaded','1');
      }
      localStorage.setItem('wizard-low-graphics','true');localStorage.setItem('wizard-trump-motion','false');localStorage.setItem('wizard-turn-sound','false');
      if(!webgl) {
        const get=HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind.startsWith('webgl')?null:get.call(this,kind,...args)};
      }
    },{record,webgl});
    const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
    if(webgl)await p.route(/\/src\/table-scene\.js(?:\?|$)/,async route=>{
      const response=await route.fetch();
      await route.fulfill({response,body:(await response.text()).replace('this.buildTrump();','this.buildTrump();window.__tablePlayScene=this;')});
    });
    await p.goto(base,{waitUntil:'domcontentloaded'});
    await p.locator('.played').first().waitFor();
    if(webgl)await p.waitForFunction(()=>window.__tablePlayScene?.cards.size&&document.body.classList.contains('has-webgl'));
    await p.waitForFunction(()=>document.querySelector('.played-cards')?.dataset.layout&&document.querySelector('.played-cards')?.dataset.layout!=='unavailable');
    await p.waitForTimeout(120);
    return {context,p};
  }
  async function inspect(p,webgl) {
    return p.evaluate(webgl=>{
      const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
      const visible=n=>n.offsetWidth&&n.offsetHeight&&getComputedStyle(n).display!=='none'&&getComputedStyle(n).visibility!=='hidden';
      const scene=window.__tablePlayScene;
      const canvas=scene?.renderer.domElement.getBoundingClientRect();
      const screen=p=>{p.project(scene.camera);return{x:canvas.left+(p.x+1)*canvas.width/2,y:canvas.top+(1-p.y)*canvas.height/2}};
      scene?.scene.updateMatrixWorld(true);
      return {layout:document.querySelector('.played-cards').dataset.layout,width:parseFloat(document.querySelector('.played-cards').style.getPropertyValue('--played-width')),
        overflow:document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1,
        camera:scene?[...scene.camera.position,...scene.camera.quaternion]:null,
        obstacles:[...document.querySelectorAll('.opponents .player,.own-status,.hand-section,.action-panel,.game-toolbar,.roundbar,.trump-display')].filter(visible).map(rect),
        cards:[...document.querySelectorAll('.played')].map(n=>{
          const face=n.querySelector('.card'),label=n.querySelector(':scope > small');
          const group=webgl?scene.cards.get(n.dataset.cardId):null;
          let r=rect(face),normal=null;
          if(group) {
            const g=group.userData.face.geometry.attributes.position;
            const corners=Array.from({length:g.count},(_,i)=>screen(group.userData.face.localToWorld(group.position.clone().set(g.getX(i),g.getY(i),g.getZ(i)))));
            r={left:Math.min(...corners.map(p=>p.x)),right:Math.max(...corners.map(p=>p.x)),top:Math.min(...corners.map(p=>p.y)),bottom:Math.max(...corners.map(p=>p.y))};
            normal=group.rotation.x;
          }
          return {id:n.dataset.cardId,player:n.dataset.player,leading:n.classList.contains('winner'),x:n.style.getPropertyValue('--play-x'),y:n.style.getPropertyValue('--play-y'),face:r,label:rect(label),name:n.querySelector('.played-name').textContent,normal,targetHeight:group?.userData.target.y,rim:group?.userData.rim.visible};
        })};
    },webgl);
  }
  async function verify(width,height,count,webgl=true) {
    const record=fixtures[`${count}-full`],{context,p}=await open(width,height,record,webgl);
    try {
      const d=await inspect(p,webgl),label=`${width}x${height}/${count}/${webgl?'3D':'fallback'}`;
      assert(!d.overflow,`${label}: page scroll`);assert(d.cards.length===count,`${label}: incomplete trick`);
      assert(d.cards.filter(c=>c.leading).length===1,`${label}: leading card`);
      assert(d.cards.find(c=>c.leading).player===`p${record.expected}`,`${label}: engine winner`);
      assert(d.width>=(width===568?42:width===360?53:width===667?47:60),`${label}: too small ${d.width}`);
      for(const [i,c] of d.cards.entries()) {
        assert(c.face.left>=0&&c.face.right<=width&&c.face.top>=0&&c.face.bottom<=height,`${label}: face offscreen ${c.player}`);
        assert(c.name.startsWith(String(Number(c.player.slice(1))+1)),`${label}: owner identity`);
        if(webgl){assert(Math.abs(c.normal)<1e-8&&Math.abs(c.targetHeight-.382)<1e-8,`${label}: card floats ${c.normal}/${c.targetHeight}`);assert(c.rim===c.leading,`${label}: gold rim`);}
        for(const o of d.obstacles)assert(!overlap(c.face,o),`${label}: ${c.player} covers a control/seat ${JSON.stringify(o)}`);
        for(const other of d.cards.slice(i+1))assert(!overlap(c.face,other.face)&&!overlap(c.label,other.face)&&!overlap(c.face,other.label)&&!overlap(c.label,other.label),`${label}: ${c.player} overlaps ${other.player}`);
      }
      if(count===6&&[1440,390,844,360,568].includes(width)) {
        const file=`${out}/${webgl?'global':'fallback'}-${count}-${width}x${height}.png`;
        await p.screenshot({path:file});screenshots.push(file);
      }
      checks.push({label,width:d.width,cards:d.cards.length,flat:webgl});
    } catch(e) {await p.screenshot({path:`${out}/failure-${width}-${count}.png`});throw e;} finally {await context.close();}
  }
  for(const [width,height] of [[1440,900],[1280,720],[390,844],[360,640],[844,390],[667,375],[568,320],[932,430]])for(const count of [3,4,5,6])await verify(width,height,count);
  for(const [width,height] of [[1440,900],[390,844],[844,390]])await verify(width,height,6,false);
  for(const [width,height] of [[1440,900],[390,844],[844,390]]) {
    const {context,p}=await open(width,height,fixtures['6-action']);
    try {
      const before=await inspect(p,true);
      assert(await p.locator('.hand').isVisible(),'normal play keeps the hand visible');
      const file=`${out}/playing-${width}x${height}.png`;await p.screenshot({path:file});screenshots.push(file);
      const hit=await p.locator('.hand .card.playable').evaluateAll(nodes=>{
        for(const n of nodes) {
          const r=n.getBoundingClientRect();
          for(const y of [r.top+9,r.top+r.height*.4])for(const x of [r.left+9,r.right-9]) {
            if(n.contains(document.elementFromPoint(x,y)))return{x,y,id:n.dataset.card};
          }
        }
        return null;
      });
      assert(hit,'a legal hand card has an accurate hit area');
      if(width<1000)await p.touchscreen.tap(hit.x,hit.y);else await p.mouse.click(hit.x,hit.y);
      const confirm=p.locator('#confirm-play');assert(await confirm.isEnabled(),'selection enables confirm');
      await p.mouse.move(width-1,height-1);await p.waitForTimeout(240);
      const handOrigin=await p.locator(`.hand [data-card="${hit.id}"]`).evaluate(n=>{const r=n.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}});
      await confirm.click();
      await p.waitForFunction(id=>!!document.querySelector(`.played[data-card-id="${id}"]`),hit.id);
      const arrival=await p.evaluate(id=>{
        const s=window.__tablePlayScene,d=s.cards.get(id).userData,c=s.renderer.domElement.getBoundingClientRect();
        const point=d.from.clone().project(s.camera);
        return{pose:s.motion.pose(id),from:{x:c.left+(point.x+1)*c.width/2,y:c.top+(1-point.y)*c.height/2}};
      },hit.id);
      assert(arrival.pose.enter<1,'fresh play uses the shared arrival clock');
      assert(Math.hypot(arrival.from.x-handOrigin.x,arrival.from.y-handOrigin.y)<3,'own card starts at its real hand position');
      await p.locator('#room-pause').click();
      const paused=await p.evaluate(id=>window.__tablePlayScene.motion.pose(id),hit.id);
      await p.waitForTimeout(120);
      assert(JSON.stringify(await p.evaluate(id=>window.__tablePlayScene.motion.pose(id),hit.id))===JSON.stringify(paused),'pause freezes the presentation clock');
      await p.locator('#room-pause').click();
      await p.waitForTimeout(450);
      const after=await inspect(p,true);
      assert(JSON.stringify(after.camera)===JSON.stringify(before.camera),'camera stays fixed when playing');
      for(const old of before.cards){const next=after.cards.find(c=>c.id===old.id);assert(next.x===old.x&&next.y===old.y,'previously played card changed destination');}
      const settled=await p.evaluate(id=>{
        const s=window.__tablePlayScene,d=s.cards.get(id).userData;
        return {pose:s.motion.pose(id),height:s.cards.get(id).position.y,target:d.target.y};
      },hit.id);
      assert(settled.pose.enter===1&&settled.pose.lift===0&&Math.abs(settled.height-settled.target)<1e-7,'card lands on felt');
      await p.reload();await p.waitForFunction(()=>window.__tablePlayScene?.cards.size===6);
      const restored=await p.evaluate(id=>window.__tablePlayScene.motion.pose(id),hit.id);
      assert(restored.enter===1,'refresh replays an already landed card');
      // Inspect the existing collect clock midway, using the same pose consumed
      // by the real renderer. No engine, network, or authority state is changed.
      const collect=await p.evaluate(id=>{
        const s=window.__tablePlayScene,m=s.motion;m.now=()=>0;m.last=0;m.time=m.collectAt+550;m.frameSample=null;
        const sample=m.snapshot();s.drawCards(sample);s.scene.updateMatrixWorld(true);
        const g=s.cards.get(id),d=g.userData,pose=sample.poses.get(id);
        const result={pose,remaining:g.position.clone().sub(d.collectTo).length(),total:d.target.clone().sub(d.collectTo).length(),height:g.position.y};
        m.time=m.collectAt+1100;m.frameSample=null;s.drawCards(m.snapshot());result.hidden=!g.visible;
        return result;
      },hit.id);
      assert(collect.pose.collect>0&&collect.pose.collect<1&&collect.pose.opacity===1,'collect keeps the face readable en route');
      assert(collect.remaining<collect.total&&collect.height>.382&&collect.hidden,'cards sweep toward the winner and finish');
      checks.push({label:`${width}x${height}/actual-play`,width:before.width,stable:true,handOrigin:true,arrival:true,pause:true,landing:true,refresh:true,collect:true});
    } finally {await context.close();}
  }
  assert(!errors.length,`Browser errors: ${errors.join('; ')}`);
  return {cases:checks.length,checks,errors,screenshots};
}
