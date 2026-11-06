import { pathToFileURL } from 'node:url';
import { exactOrigin } from './site-config.mjs';

export async function probe(origin, revision, { publicOrigin = origin, fetcher = fetch, socketFactory = url => new WebSocket(url) } = {}) {
  exactOrigin(origin); exactOrigin(publicOrigin);
  const read = async path => {
    const response = await fetcher(new URL(path, origin), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw Error(`${path}: HTTP ${response.status}`);
    return response;
  };
  const endpoints = await Promise.all(['/api/health', '/build-info.json', '/runtime-config.json'].map(async path => {
    return (await read(path)).json();
  }));
  const [health, frontend, runtime] = endpoints;
  if (health.transport !== 'node-websocket' || health.version !== 2 || health.revision !== revision || frontend.revision !== revision) throw Error('Frontend/backend revision or protocol mismatch.');
  if (health.siteEdition !== 'cn' || frontend.siteEdition !== 'cn' || runtime.siteEdition !== 'cn' || runtime.backends?.length !== 1) throw Error('Frontend, backend and public registry must all use cn.');
  if (runtime.backendId !== 'aliyun' || runtime.relayOrigin !== '') throw Error('Aliyun must override any compiled Cloudflare relay with its same-origin backend.');
  const domestic = runtime.backends?.find(entry => entry.id === 'aliyun');
  if (domestic?.origin !== publicOrigin || typeof domestic.enabled !== 'boolean') throw Error('Deployed Aliyun entry was overwritten or does not match the configured public origin.');

  const html = await (await read('/')).text();
  const assets = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["'][^>]*>/gi)].map(match => new URL(match[1], origin));
  if (!assets.some(asset => /\.js$/.test(asset.pathname))) throw Error('Built frontend script is missing.');
  for (const asset of assets) {
    if (asset.origin !== new URL(origin).origin) throw Error('Frontend assets must be served by this entry.');
    const response = await read(asset.pathname + asset.search);
    const type = response.headers.get('content-type') || '';
    if ((/\.js$/.test(asset.pathname) && !/(?:javascript|ecmascript)/i.test(type)) || (/\.css$/.test(asset.pathname) && !/text\/css/i.test(type))) throw Error('Static asset returned the wrong content type or an HTML fallback.');
  }
  const url = new URL('/api/connectivity/ws', origin); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  await new Promise((resolve, reject) => {
    const socket = socketFactory(url);
    const timer = setTimeout(() => finish(Error('WebSocket upgrade/protocol marker timed out.')), 6000);
    function finish(error) { clearTimeout(timer); socket.onclose = socket.onerror = socket.onmessage = null; socket.close(); error ? reject(error) : resolve(); }
    socket.onmessage = event => {
      try { const data = JSON.parse(event.data); if (data.type !== 'probe' || data.version !== 2 || data.revision !== revision) throw Error('WebSocket protocol/revision mismatch.'); finish(); }
      catch (e) { finish(e); }
    };
    socket.onerror = () => finish(Error('WebSocket connection failed.'));
    socket.onclose = () => finish(Error('WebSocket closed before the protocol marker.'));
  });
  return { revision, origin, version: health.version };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await probe(process.argv[2], process.argv[3])));
