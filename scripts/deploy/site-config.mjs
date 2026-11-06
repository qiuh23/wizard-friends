import { pathToFileURL } from 'node:url';

const reserved = new Set([3000, 3001, 8080]);
export function exactOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('Set an exact HTTP(S) public origin.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value || url.username || url.password || url.hostname.includes('*')) throw Error('Set an exact HTTP(S) public origin without wildcards, credentials, path, query or fragment.');
  return url;
}
export function siteConfig({ origin, port = '3002', publicPort, legacyOrigin = '' }) {
  const url = exactOrigin(origin);
  const internal = Number(port), external = Number(publicPort || url.port || (url.protocol === 'https:' ? 443 : 80));
  if (!/^\d+$/.test(String(port)) || internal < 1024 || internal > 65535 || reserved.has(internal)) throw Error('Invalid or athlete-reserved internal port.');
  if (!Number.isInteger(external) || external < 1 || external > 65535 || external === internal || reserved.has(external)) throw Error('Invalid or athlete-reserved public port.');
  if (external !== Number(url.port || (url.protocol === 'https:' ? 443 : 80))) throw Error('PUBLIC_PORT must match PUBLIC_ORIGIN.');
  if (url.protocol === 'http:' && external < 1024) throw Error('Plain HTTP must retain an independent high-port listener; port 80 belongs to the existing site.');
  if (url.protocol === 'https:' && (external !== 443 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(url.hostname))) throw Error('HTTPS requires an exact DNS hostname on port 443.');
  let legacy = null;
  if (legacyOrigin) {
    const old = exactOrigin(legacyOrigin);
    const oldPort = Number(old.port || 80);
    if (url.protocol !== 'https:' || old.protocol !== 'http:' || oldPort < 1024 || oldPort > 65535 || reserved.has(oldPort) || oldPort === internal) throw Error('Legacy HTTP must use a separate nonreserved high port.');
    legacy = { origin: old.origin, hostname: old.hostname, port: oldPort };
  }
  return { origin: url.origin, hostname: url.hostname, tls: url.protocol === 'https:', port: internal, publicPort: external, legacy };
}
const proxy = port => `    client_max_body_size 256k;
    access_log off;
    error_log /var/log/nginx/wizard-friends-error.log warn;
    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header Origin $http_origin;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 100s;
        proxy_send_timeout 100s;
        proxy_buffering off;
    }`;
export function renderSite(config) {
  if (!config.tls) return `server {
    listen ${config.publicPort};
    server_name _;
${proxy(config.port)}
}
`;
  return `# Wizard only. Preserve the athlete production/preview sites and listeners.
server {
    listen 80;
    server_name ${config.hostname};
    access_log off;
    error_log /var/log/nginx/wizard-friends-error.log warn;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/wizard-friends-acme;
        default_type text/plain;
        try_files $uri =404;
    }
    location / { return 308 https://${config.hostname}$request_uri; }
}
server {
    listen 443 ssl;
    server_name ${config.hostname};
    ssl_certificate /etc/letsencrypt/live/${config.hostname}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${config.hostname}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
${proxy(config.port)}
}
${config.legacy ? `# No redirect: the old origin retains its own browser identities and active rooms.
server {
    listen ${config.legacy.port};
    server_name ${config.legacy.hostname};
${proxy(config.port)}
}
` : ''}`;
}
export function renderAcmeSite(config) {
  if (!config.tls) throw Error('ACME bootstrap requires HTTPS target.');
  return `# Temporary companion to the existing Wizard 8081 site; no game redirects.
server {
    listen 80;
    server_name ${config.hostname};
    access_log off;
    error_log /var/log/nginx/wizard-friends-error.log warn;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/wizard-friends-acme;
        default_type text/plain;
        try_files $uri =404;
    }
    location / { return 503; }
}
`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = siteConfig({ origin: process.env.PUBLIC_ORIGIN, port: process.env.PORT, publicPort: process.env.PUBLIC_PORT, legacyOrigin: process.env.LEGACY_PUBLIC_ORIGIN });
  if (process.argv[2] === 'render') process.stdout.write(renderSite(config));
  else if (process.argv[2] === 'port') console.log(config.publicPort);
  else if (process.argv[2] === 'validate') console.log('Wizard public origin and isolated ports validated.');
  else throw Error('Expected validate, port or render.');
}
