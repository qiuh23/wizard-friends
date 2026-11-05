import { test as base, expect } from '@playwright/test';
import { createServer } from '../../server/index.js';
export const test=base.extend({
  application:[async({},use)=>{const app=await createServer({port:3196,databasePath:':memory:',publicOrigin:'http://127.0.0.1:3196',env:{}});await app.listen();try{await use(app);}finally{await app.close();}},{scope:'worker'}],
  baseURL:async({application},use)=>use('http://127.0.0.1:3196'),
});
export {expect};
