// This panel lives outside #app so game-state updates never interrupt typing.
import { ChatNotices, CHAT_NOTICE_EXIT_MS } from './chat-notices.js';
export class RoomSocial {
  constructor(send, onLayout = () => {}) {
    this.send = send;
    this.onLayout = onLayout; this.notices = new ChatNotices();
    this.seen = 0;
    this.root = document.createElement('div');
    this.root.id = 'room-social';
    this.root.hidden = true;
    this.root.innerHTML = `
      <section id="room-chat" class="social-panel" aria-label="房间聊天" hidden>
        <div class="social-heading"><b>房间聊天</b><button id="close-chat" aria-label="收起聊天">×</button></div><small class="chat-context"></small>
        <div id="chat-messages" role="log" aria-live="polite" aria-relevant="additions" tabindex="0"></div>
        <form id="chat-form"><label class="sr-only" for="chat-input">聊天消息</label><input id="chat-input" maxlength="300" autocomplete="off" placeholder="说点什么…"><button type="submit">发送</button></form>
      </section>
      <section id="rename-panel" class="social-panel" aria-label="修改昵称" hidden>
        <div class="social-heading"><b>修改昵称</b><button id="close-rename" aria-label="取消改名">×</button></div>
        <form id="rename-form"><label class="sr-only" for="rename-input">新昵称</label><input id="rename-input" maxlength="16" required autocomplete="off"><button type="submit">保存</button></form>
      </section>`;
    document.body.append(this.root);
    this.dock = document.createElement('div'); this.dock.className = 'chat-dock'; this.root.append(this.dock);
    this.noticeRegion = document.createElement('div'); this.noticeRegion.className = 'chat-notices';
    this.noticeRegion.setAttribute('aria-live', 'polite'); this.noticeRegion.setAttribute('aria-label', '新聊天消息'); this.root.append(this.noticeRegion);
    this.chat = this.root.querySelector('#room-chat');
    this.rename = this.root.querySelector('#rename-panel');
    this.list = this.root.querySelector('#chat-messages');
    this.input = this.root.querySelector('#chat-input');
    this.nameInput = this.root.querySelector('#rename-input');
    this.root.querySelector('#close-chat').onclick = () => { this.chat.hidden = true; this.refreshButton(); this.chatButton?.focus(); };
    this.root.querySelector('#close-rename').onclick = () => { this.rename.hidden = true; this.renameButton?.focus(); };
    this.root.querySelector('#chat-form').onsubmit = event => {
      event.preventDefault();
      if (this.input.value.trim() && this.send({ type: 'chat', text: this.input.value })) this.input.value = '';
      this.input.focus();
    };
    this.root.querySelector('#rename-form').onsubmit = event => {
      event.preventDefault();
      if (this.send({ type: 'rename', name: this.nameInput.value })) this.rename.hidden = true;
    };
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        this.chat.hidden = this.rename.hidden = true;
        this.refreshButton();
      }
    });
    const viewport = window.visualViewport;
    const keyboard = () => {
      this.root.style.setProperty('--chat-keyboard-offset', `${viewport ? Math.max(0, innerHeight - viewport.height - viewport.offsetTop) : 0}px`);
      this.onLayout();
    };
    viewport?.addEventListener('resize', keyboard); viewport?.addEventListener('scroll', keyboard);
    document.addEventListener('visibilitychange', () => {
      this.notices.hydrated = false; this.notices.items = [];
      if (!document.hidden && !this.root.hidden) this.notices.update(this.messages || [], this.me, this.connected);
      this.renderNotices();
    });
  }
  refreshButton() {
    const open = String(!this.root.hidden && !this.chat.hidden);
    if (document.body.dataset.chatOpen !== open) { document.body.dataset.chatOpen = open; requestAnimationFrame(() => this.onLayout()); }
    if (!this.chatButton) return;
    const unread = (this.messages || []).filter(m => m.seq > this.seen && m.player !== this.me).length;
    this.chatButton.textContent = `聊天${this.chat.hidden && unread ? ` · ${unread}` : ''}`;
    this.chatButton.setAttribute('aria-expanded', String(!this.chat.hidden));
  }
  openChat() {
    this.chat.hidden = false; this.rename.hidden = true; this.seen = this.latestChat || 0;
    this.notices.items = []; this.renderNotices(); this.list.scrollTop = this.list.scrollHeight;
    this.input.focus(); this.refreshButton();
  }
  closeChat() { this.chat.hidden = true; this.refreshButton(); }
  renderNotices() {
    clearTimeout(this.noticeTimer);
    const now = Date.now(), items = this.notices.advance(now, matchMedia('(max-width:850px)').matches ? 3 : 5);
    const ids = new Set(items.map(n => String(n.message.seq)));
    for (const node of [...this.noticeRegion.children]) if (!ids.has(node.dataset.seq)) node.remove();
    for (const notice of items) {
      const { message } = notice;
      let node = [...this.noticeRegion.children].find(n => n.dataset.seq === String(message.seq));
      if (!node) {
        node = document.createElement('button'); node.type = 'button'; node.className = 'chat-notice'; node.dataset.seq = message.seq;
        const name = document.createElement('strong'), body = document.createElement('span');
        name.textContent = message.name; body.textContent = message.text.length > 160 ? `${message.text.slice(0,160)}…` : message.text;
        node.append(name, body); node.onclick = () => this.openChat(); this.noticeRegion.append(node);
      }
      node.classList.toggle('is-leaving', notice.leaving);
    }
    if (items.length) this.noticeTimer = setTimeout(() => this.renderNotices(), Math.max(16, Math.min(...items.map(n => n.expiresAt + (n.leaving ? CHAT_NOTICE_EXIT_MS : 0) - now))));
  }
  update(state, me, controls, { connected = true, room = '' } = {}) {
    this.connected = connected;
    this.root.hidden = !state;
    if (!state) {
      this.chat.hidden = this.rename.hidden = true;
      this.list.replaceChildren(); this.key = null; this.seen = 0; this.input.value = ''; this.roomKey = null;
      this.notices.reset(); this.renderNotices(); this.refreshButton();
      return;
    }
    if (!controls) return;
    if (this.roomKey !== `${room}:${me}`) { this.notices.reset(); this.list.replaceChildren(); this.key = null; this.seen = state.chatSeq || 0; this.roomKey = `${room}:${me}`; }
    this.me = me;
    this.messages = state.chat || [];
    this.latestChat = state.chatSeq || 0;
    const own = state.players.find(p => p.id === me);
    this.root.querySelector('.chat-context').textContent = own ? `${own.name} · 预测 ${own.bid ?? '—'} / 实赢 ${own.won} · ${own.score} 分` : '观战中 · 仅公开信息';
    this.notices.update(this.messages, me, connected && !document.hidden, Date.now(), matchMedia('(max-width:850px)').matches ? 3 : 5);
    if (!this.chat.hidden) this.notices.items = [];
    this.renderNotices();
    this.chatButton = document.createElement('button');
    this.chatButton.id = 'chat-toggle';
    this.chatButton.setAttribute('aria-controls', 'room-chat');
    this.chatButton.onclick = () => {
      this.chat.hidden = !this.chat.hidden;
      if (!this.chat.hidden) this.openChat();
      this.refreshButton();
    };
    this.renameButton = document.createElement('button');
    this.renameButton.id = 'rename-toggle';
    this.renameButton.textContent = '改名';
    this.renameButton.onclick = () => {
      this.chat.hidden = true; this.rename.hidden = false;
      this.nameInput.value = state.players.find(p => p.id === me)?.name || '';
      this.nameInput.focus(); this.nameInput.select(); this.refreshButton();
    };
    controls.prepend(this.renameButton);
    this.dock.replaceChildren(this.chatButton);
    if (!this.chat.hidden) this.seen = state.chatSeq || 0;
    const key = JSON.stringify(this.messages);
    if (key !== this.key) {
      const atBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 40;
      this.key = key;
      // Retain existing nodes so screen readers announce only newly added messages.
      const retained = new Set(this.messages.map(m => String(m.seq)));
      for (const node of this.list.children) if (!retained.has(node.dataset.seq)) node.remove();
      for (const message of this.messages) {
        if ([...this.list.children].some(node => node.dataset.seq === String(message.seq))) continue;
        const row = document.createElement('p'); row.dataset.seq = message.seq;
        row.className = message.player === me ? 'own-message' : '';
        const name = document.createElement('b'); name.textContent = message.name;
        const text = document.createElement('span'); text.textContent = message.text;
        row.append(name, text); this.list.append(row);
      }
      if (atBottom) this.list.scrollTop = this.list.scrollHeight;
    }
    this.refreshButton();
  }
}
