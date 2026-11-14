import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createGame, addPlayer, act, viewFor } from '../src/game.js';
import { DEFAULT_OPTIONS } from '../src/rules-options.js';
mkdirSync('.local/component-tests',{recursive:true});
const path=new URL('../.local/component-tests/seat-table.mjs',import.meta.url);
writeFileSync(path,buildSync({entryPoints:['src/ui/table.tsx'],bundle:true,platform:'node',format:'esm',packages:'external',write:false,jsx:'automatic'}).outputFiles[0].contents);
const {TableScreen}=await import(path.href);
test('each seat exposes one native avatar-and-name button with retained metrics and avatar anchors',()=>{
 const game=createGame();for(let i=0;i<6;i++)addPlayer(game,`p${i}`,`玩家${i}`);
 act(game,'p0',{type:'start',options:DEFAULT_OPTIONS});
 const state=viewFor(game,'p0');
 const html=renderToStaticMarkup(createElement(TableScreen,{model:{state,me:'p0',practice:true,networkReady:true,domestic:true,scoresOpen:false,cardTiming:()=>({enterMs:0,collectMs:null})}}));
 const buttons=[...html.matchAll(/<button[^>]*class="seat-details"[^>]*>.*?<\/button>/g)].map(m=>m[0]);
 assert.equal(buttons.length,6);assert.equal((html.match(/data-player-details=/g)||[]).length,6);
 for(const button of buttons){assert.match(button,/type="button"/);assert.match(button,/aria-controls="table-score-panel"/);assert.match(button,/aria-expanded="false"/);assert.match(button,/<span class="avatar"[^>]*style="--avatar-color:/);assert.match(button,/class="(?:seat-name|own-name)"/);assert.equal((button.match(/<button/g)||[]).length,1);}
 assert.equal((html.match(/class="prediction"/g)||[]).length,5);assert.match(html,/class="own-metrics"/);
 const css=readFileSync(new URL('../src/table-clarity.css',import.meta.url),'utf8');assert.match(css,/\.seat-details \{[\s\S]*?min-width:44px;min-height:44px/);assert.match(css,/data-low-height="true"[^\n]*width:26px/);assert.match(css,/\.seat-details:focus-visible/);
});
