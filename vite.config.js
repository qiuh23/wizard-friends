import { defineConfig } from 'vite';
import { normalizeEdition } from './src/site-policy.js';
export default defineConfig(({ command }) => {
  const edition = normalizeEdition(process.env.SITE_EDITION || (command === 'serve' ? 'global' : undefined));
  return {
    base: './', define: { __SITE_EDITION__: JSON.stringify(edition) },
    server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
  };
});
