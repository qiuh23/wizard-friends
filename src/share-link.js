export async function copyInvitation(value, { clipboard = globalThis.navigator?.clipboard, document = globalThis.document } = {}) {
  try {
    if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
    await clipboard.writeText(value);
    return true;
  } catch {
    document.querySelector('#share-link-dialog')?.remove();
    const backdrop = document.createElement('div');
    backdrop.id = 'share-link-dialog'; backdrop.className = 'modal-backdrop';
    const panel = document.createElement('section');
    panel.className = 'modal'; panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'share-link-title');
    const heading = document.createElement('h2');
    heading.id = 'share-link-title'; heading.textContent = '复制邀请链接';
    const help = document.createElement('p'); help.textContent = '自动复制不可用，请选择下面的完整链接后复制，发给朋友。';
    const input = document.createElement('input');
    input.id = 'share-link-text'; input.readOnly = true; input.value = value;
    input.setAttribute('aria-label', '完整邀请链接');
    input.addEventListener('click', () => input.select());
    const close = document.createElement('button');
    close.textContent = '关闭'; close.className = 'wide';
    const dismiss = () => backdrop.remove();
    close.onclick = dismiss;
    backdrop.addEventListener('keydown', event => { if (event.key === 'Escape') dismiss(); });
    panel.append(heading, help, input, close); backdrop.append(panel); document.body.append(backdrop);
    input.focus(); input.select();
    return false;
  }
}
