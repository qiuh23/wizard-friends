import { defineConfig } from '@playwright/test';
// Explicit local review only; no workflow or CI matrix changes.
export default defineConfig({
  testDir:'./tests/room-experience',outputDir:'.local/room-experience-results',timeout:90000,
  expect:{timeout:10000},workers:1,retries:0,reporter:'list',
  use:{headless:true,viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce',screenshot:'only-on-failure'},
  projects:[
    {name:'chromium',use:{browserName:'chromium',channel:process.platform==='win32'?'msedge':undefined,launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}}},
    {name:'webkit',use:{browserName:'webkit'}},
  ],
});
