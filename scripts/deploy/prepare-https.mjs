// Offline preparation only. Never connects to a server, DNS, ACME or cloud API.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderAcmeSite, renderSite, siteConfig } from './site-config.mjs';

const output = process.argv[2];
if (!output) throw Error('Usage: node scripts/deploy/prepare-https.mjs <new local output directory>');
const config = siteConfig({ origin: process.env.PUBLIC_ORIGIN || 'https://wizard.magical-athlete-online.cn', port: process.env.PORT || '3002', legacyOrigin: process.env.LEGACY_PUBLIC_ORIGIN || 'http://115.29.188.62:8081' });
if (!config.tls) throw Error('Preparation requires HTTPS.');
const directory = resolve(output);
// Refuse to overwrite an existing review bundle.
await mkdir(directory);
await writeFile(resolve(directory, 'wizard-friends.nginx.conf'), renderSite(config));
await writeFile(resolve(directory, 'wizard-friends-acme.nginx.conf'), renderAcmeSite(config));
await writeFile(resolve(directory, 'wizard-friends-nginx-renewal.sh'), '#!/usr/bin/env bash\nset -euo pipefail\n/usr/sbin/nginx -t\n/bin/systemctl reload nginx\n');
const backends = [{ id: 'cloudflare', origin: 'https://wizard-friends.qiuh23.workers.dev', enabled: true }, { id: 'aliyun', origin: config.origin, enabled: true }];
await writeFile(resolve(directory, 'server.env.patch'), `# Merge these public settings into the existing root-managed env after TLS verification.
# Preserve DATABASE_PATH, STATIC_DIR, HOST, PORT and any other existing settings.
PUBLIC_ORIGIN=${config.origin}
ALLOWED_ORIGINS=${config.legacy?.origin || ''}
BACKENDS_CONFIG_JSON='${JSON.stringify({ backends })}'
`);
await writeFile(resolve(directory, 'runtime-config.cloudflare.json'), JSON.stringify({ backendId: 'cloudflare', relayOrigin: null, backends: [{ ...backends[0], origin: '' }, backends[1]] }, null, 2) + '\n');
await writeFile(resolve(directory, 'README.txt'), `REVIEW ONLY — no online operation performed.
Public origin: ${config.origin}
Legacy origin remains served: ${config.legacy?.origin || '(none)'}
See docs/https-domain-transition.md for DNS, ACME bootstrap, configuration locking,
same-origin tests, issuance/renewal, staged enablement and rollback.
Do not install this TLS site before the certificate exists.
The Cloudflare runtime candidate is not part of the default release.
`);
console.log(`Review bundle prepared locally: ${directory}`);
