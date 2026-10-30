import { pathToFileURL } from 'node:url';

export async function probe(origin, revision) {
  const endpoints = await Promise.all(['/api/health', '/build-info.json', '/runtime-config.json'].map(async path => {
    const response = await fetch(new URL(path, origin), { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }));
  const [health, frontend, runtime] = endpoints;
  if (health.transport !== 'node-websocket' || health.version !== 2 || health.revision !== revision || frontend.revision !== revision) throw Error('Frontend/backend revision or protocol mismatch.');
  if (runtime.backendId !== 'aliyun' || runtime.relayOrigin !== '') throw Error('Aliyun must override any compiled Cloudflare relay with its same-origin backend.');
  const url = new URL('/api/connectivity/ws', origin); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
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
