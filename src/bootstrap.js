import { backendStorage, invitationRedirect, loadRuntimeConfig } from './backend-entry.js';
import { readRoomSession } from './room-session.js';

loadRuntimeConfig().then(() => {
  const saved = readRoomSession(backendStorage(sessionStorage));
  const target = invitationRedirect(location, !!saved);
  if (target) { location.replace(target); return; }
  return import('./main.js');
}).catch(error => {
  const app = document.querySelector('#app');
  const text = document.createElement('p');
  text.textContent = error.message || '入口暂不可用，请刷新重试。';
  const retry = document.createElement('button');
  retry.textContent = '重新加载'; retry.onclick = () => location.reload();
  app.replaceChildren(text, retry);
});
