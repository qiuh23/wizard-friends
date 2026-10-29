import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import { createGame, addPlayer, act, viewFor } from '../src/game.js';
import { createRandomStream } from '../src/random.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';

// Local/manual geometry and renderer regression; all fixtures use legal actions.
// Inspection references are injected into browser responses, never production.
const base=process.env.GAME_URL||'http://127.0.0.1:5173/';
const out='output/playwright';fs.mkdirSync(out,{recursive:true});
const errors=[],checks=[];
function fixture(count,full) {
  const game=createGame();game.randomState=createRandomStream(Array(11).fill(12));
  for(let i=0;i<count;i++)addPlayer(game,`p${i}`,['桥','青岚','青云','清月','星河','林语'][i]);
  act(game,'p0',{type:'start',options:DEFAULT_OPTIONS});
  for(let i=0;i<5000;i++) {
    if(game.round===2&&game.phase==='play'&&!game.trick.length)break;
    const id=game.players[game.turn].id;
    const action=game.phase==='trump'?{type:'trump',suit:'yellow'}:game.phase==='bid'?{type:'bid',value:viewFor(game,id).bids[0]}:game.phase==='play'?{type:'play',card:viewFor(game,id).legal[0]}:{type:'next'};
    act(game,['trickEnd','roundEnd'].includes(game.phase)?'p0':id,action);
  }
  for(let i=0;i<(full?count:2);i++){const id=game.players[game.turn].id;act(game,id,{type:'play',card:viewFor(game,id).legal[0]});}
  game.turnDeadline=Date.now()+600000;
  return {version:1,role:'practice',room:'离线练习',me:'p0',game,identities:{}};
}
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
const overlaps=(a,b)=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;
async function inspect(page,webgl) {
  return page.evaluate(webgl=>{
    const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    const visible=node=>node.offsetWidth&&node.offsetHeight&&getComputedStyle(node).visibility!=='hidden';
    const scene=window.__playedScene,canvas=scene?.renderer.domElement.getBoundingClientRect();
    const screen=p=>{p=p.clone().project(scene.camera);return {x:canvas.left+(p.x+1)*canvas.width/2,y:canvas.top+(1-p.y)*canvas.height/2}};
    const avatar=id=>document.querySelector(`.opponents [data-player="${id}"] .avatar`)||document.querySelector('.own-status .avatar');
    const center=node=>{const r=node.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}};
    const trump=document.querySelector('.trump-display[data-occluded="false"] .trump-card');
    const winnerId=document.querySelector('.played.winner')?.dataset.player;
    return {layout:document.querySelector('.played-cards').dataset.layout,
      sources:[...document.querySelectorAll('.opponents .avatar,.own-status .avatar')].map(node=>({id:node.dataset.playerDetails,...center(node)})),
      faceWidth:parseFloat(document.querySelector('.played-cards').style.getPropertyValue('--played-width')),
      obstacles:[...document.querySelectorAll('.opponents .player,.own-status,.action-panel,.hand-section,.roundbar,.game-toolbar,.foresight-hands,.lifecycle-banner')].filter(visible).map(rect).concat(trump?[rect(trump)]:[]),
      trump:trump?center(trump):null,overflow:document.documentElement.scrollWidth>innerWidth,
      cards:[...document.querySelectorAll('.played')].map(node=>{
        const face=node.querySelector('.card'),r=rect(node),card={x:r.left+face.offsetLeft+face.offsetWidth/2,y:r.top+face.offsetTop+face.offsetHeight/2};
        const group=webgl?scene.cards.get(face.dataset.card||[...scene.cards].find(([,g])=>scene.state.players[g.userData.player].id===node.dataset.player)?.[0]):null;
        return {id:node.dataset.player,rect:r,card,source:center(avatar(node.dataset.player)),winner:center(avatar(winnerId)),
          from:{x:card.x+parseFloat(node.style.getPropertyValue('--from-x')),y:card.y+parseFloat(node.style.getPropertyValue('--from-y'))},
          collect:{x:card.x+parseFloat(node.style.getPropertyValue('--winner-dx')),y:card.y+parseFloat(node.style.getPropertyValue('--winner-dy'))},
          mesh:group?{position:screen(group.position),target:screen(group.userData.target),from:screen(group.userData.from),collect:screen(group.userData.collectTo)}:null};
      })};
  },webgl);
}
try {
  for(const webgl of [true,false])for(const[width,height]of(webgl?[[1440,900],[1280,720],[1105,482],[844,390],[667,375],[390,844],[360,640]]:[[1440,900],[844,390],[390,844]]))for(const count of[3,4,5,6])for(const full of[false,true]){
    if(process.env.PLAYED_SIZE&&Number(process.env.PLAYED_SIZE)!==width)continue;
    if(process.env.PLAYED_COUNT&&Number(process.env.PLAYED_COUNT)!==count)continue;
    const record=fixture(count,full);
    const context=await browser.newContext({viewport:{width,height},hasTouch:width<1106,reducedMotion:'no-preference'});
    await context.addInitScript(({record,webgl})=>{
      if(!sessionStorage.getItem('played-review-loaded')){sessionStorage.setItem('wizard-room-session',JSON.stringify(record));sessionStorage.setItem('played-review-loaded','1');}
      localStorage.setItem('wizard-low-graphics','true');localStorage.setItem('wizard-trump-motion','false');localStorage.setItem('wizard-turn-sound','false');
      if(!webgl){const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind.startsWith('webgl')?null:get.call(this,kind,...args)};}
    },{record,webgl});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.route(/\/src\/table-scene\.js(?:\?|$)/,async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('this.animate(0);','window.__playedScene=this;this.animate(0);')});});
      await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('.played').first().waitFor();
      if(webgl)await page.waitForFunction(()=>window.__playedScene?.mode==='game');
      await page.waitForTimeout(160);
      const data=await inspect(page,webgl),label=JSON.stringify({width,height,count,webgl,full});
      try {
        expect(data.layout,label).toBe('seats');expect(data.overflow,label).toBe(false);
        expect(data.cards.length,label).toBe(full?count:2);
        for(const c of data.cards){
          expect(c.rect.left,label).toBeGreaterThanOrEqual(0);expect(c.rect.right,label).toBeLessThanOrEqual(width);
          expect(c.rect.top,label).toBeGreaterThanOrEqual(0);expect(c.rect.bottom,label).toBeLessThanOrEqual(height);
          for(const o of data.obstacles)expect(overlaps(c.rect,o),`${label} ${c.id} overlaps ${JSON.stringify(o)}`).toBe(false);
          if(data.trump)expect(Math.hypot(c.card.x-data.trump.x,c.card.y-data.trump.y),`${label}: card must remain inward from its avatar`).toBeLessThan(Math.hypot(c.source.x-data.trump.x,c.source.y-data.trump.y));
          if(data.trump){
            const direction=source=>((c.card.x-data.trump.x)*(source.x-data.trump.x)+(c.card.y-data.trump.y)*(source.y-data.trump.y))/Math.hypot(source.x-data.trump.x,source.y-data.trump.y);
            for(const other of data.sources.filter(s=>s.id!==c.id))expect(direction(c.source),`${label}: ${c.id} is in ${other.id}'s direction`).toBeGreaterThanOrEqual(direction(other)-.01);
          }
          for(const [point,target]of[[c.from,c.source],[c.collect,c.winner],...(webgl?[[c.mesh.target,c.card],[c.mesh.position,c.card],[c.mesh.from,c.source],[c.mesh.collect,c.winner]]:[])])expect(Math.hypot(point.x-target.x,point.y-target.y),label).toBeLessThan(2);
        }
        for(let i=0;i<data.cards.length;i++)for(let j=i+1;j<data.cards.length;j++)expect(overlaps(data.cards[i].rect,data.cards[j].rect),label).toBe(false);
      }catch(error){await page.screenshot({path:`${out}/played-card-failure.png`});fs.writeFileSync(`${out}/played-card-failure.json`,JSON.stringify({label,data},null,2));throw error;}
      checks.push({width,height,count,webgl,full,...data});
      if(webgl&&full&&[3,6].includes(count))await page.screenshot({path:`${out}/played-cards-${count}-${width}.png`});
    await context.close();if(full)console.log(JSON.stringify({width,height,count,webgl,checked:checks.length}));
  }
  expect(errors).toEqual([]);fs.writeFileSync(`${out}/played-card-review.json`,JSON.stringify({checks,errors},null,2));
  console.log(JSON.stringify({cases:checks.length,errors}));
}finally{await browser.close()}
