import { defineConfig } from 'vite';
import { normalizeEdition } from './src/site-policy.js';
import { assetCachePlugin } from './scripts/asset-cache.mjs';
export default defineConfig(({ command }) => {
  const edition = normalizeEdition(process.env.SITE_EDITION || (command === 'serve' ? 'global' : undefined));
  return {
    base: './', plugins: [assetCachePlugin()], define: { __SITE_EDITION__: JSON.stringify(edition) },
    server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
  };
});
