// Operator-only CLI. The secret is read from the environment, never argv or URL.
import { readFile } from 'node:fs/promises';
const [origin,room]=process.argv.slice(2);
try {
  const base=new URL(origin);
  if(base.origin!==origin || base.username || base.password || (base.protocol!=='https:' && !(base.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(base.hostname)))) throw Error('Use an exact HTTPS origin or a loopback SSH tunnel.');
  if(!(/^[A-Z2-9]{8}$/.test(room) || room==='security')) throw Error('Supply a room code or security.');
  const token=process.env.SECURITY_ADMIN_TOKEN;
  if(!token || token.length<32) throw Error('Set SECURITY_ADMIN_TOKEN using the protected operator environment.');
  const text=await readFile(0,'utf8');if(text.length>4096)throw Error('Operation JSON exceeds 4096 characters.');const input=JSON.parse(text);
  const response=await fetch(`${origin}/api/stationmaster/${room==='security'?'security':`rooms/${room}`}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`Stationmaster operation failed (HTTP ${response.status}).`);
  console.log(JSON.stringify(await response.json(),null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
