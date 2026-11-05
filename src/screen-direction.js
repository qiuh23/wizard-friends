// Display controls stay outside the game tree and use no resize listeners.
export class ScreenDirection {
    dialog = document.createElement('dialog');
    busy = false;
    locked = false;
    ownedFullscreen = null;
    generation = 0;
    disposed = false;
    trigger = null;
    constructor() {
        this.dialog.className = 'screen-direction';
        this.dialog.id = 'screen-direction';
        this.dialog.setAttribute('aria-labelledby', 'direction-title');
        this.dialog.setAttribute('aria-describedby', 'direction-help');
        this.dialog.innerHTML = `<header><h2 id="direction-title">屏幕方向</h2><button type="button" data-direction-close aria-label="关闭屏幕方向">×</button></header>
      <p id="direction-help">横竖屏都能玩。手动旋转手机即可调整；若没有变化，请检查手机的自动旋转设置。</p>
      <p data-direction-status role="status" aria-live="polite"></p>
      <fieldset><legend>尝试锁定方向</legend>
        <label><input type="checkbox" id="direction-fullscreen">全屏后尝试（会隐藏浏览器工具栏）</label>
        <p>部分浏览器需要全屏才允许锁定。仅勾选后点击下方按钮，才会请求全屏。</p>
        <div class="direction-actions"><button type="button" data-direction="landscape">尝试横屏</button><button type="button" data-direction="portrait">尝试竖屏</button></div>
      </fieldset>
      <button type="button" data-direction-reset>恢复自动旋转并退出本次全屏</button>`;
        document.body.append(this.dialog);
        this.dialog.querySelector('[data-direction-close]').addEventListener('click', () => this.dialog.close());
        this.dialog.querySelector('[data-direction-reset]').addEventListener('click', () => void this.restore());
        this.dialog.querySelectorAll('[data-direction]').forEach(button => {
            button.addEventListener('click', () => void this.request(button.dataset.direction));
        });
        // Keep an underlying game menu/modal open and preserve its keyboard state.
        this.dialog.addEventListener('keydown', event => event.stopPropagation());
        this.dialog.addEventListener('pointerdown', event => event.stopPropagation());
        this.dialog.addEventListener('click', event => event.stopPropagation());
        this.dialog.addEventListener('close', () => { if (this.trigger?.isConnected)
            this.trigger.focus({ preventScroll: true }); });
        document.addEventListener('click', this.open, true);
        document.addEventListener('fullscreenchange', this.fullscreenChanged);
        this.status(this.orientation()?.lock ? '方向锁定是否可用，取决于浏览器和手机设置。' : '此浏览器不支持方向锁定，请手动旋转手机，当前页面可继续使用。');
        this.update();
    }
    orientation() { return screen.orientation; }
    status(text) { this.dialog.querySelector('[data-direction-status]').textContent = text; }
    update() {
        const supported = typeof this.orientation()?.lock === 'function';
        this.dialog.querySelector('fieldset').disabled = this.busy || !supported;
        this.dialog.querySelector('#direction-fullscreen').disabled = this.busy || !supported || !document.fullscreenEnabled || typeof document.documentElement.requestFullscreen !== 'function';
        this.dialog.querySelector('[data-direction-reset]').disabled = !this.busy && !this.locked && !this.ownedFullscreen;
    }
    open = (event) => {
        const trigger = event.target?.closest('[data-screen-direction]');
        if (!trigger || this.dialog.open)
            return;
        event.preventDefault();
        this.trigger = trigger;
        this.dialog.showModal();
    };
    fullscreenChanged = () => {
        if (this.ownedFullscreen && document.fullscreenElement !== this.ownedFullscreen) {
            this.ownedFullscreen = null;
            this.generation++;
            try {
                this.orientation()?.unlock();
            }
            catch { /* Browser already released it. */ }
            this.locked = false;
            this.status('已退出全屏并恢复自动旋转，可手动旋转手机。');
            this.update();
        }
    };
    async exitOwnedFullscreen() {
        const owned = this.ownedFullscreen;
        this.ownedFullscreen = null;
        try {
            if (owned && document.fullscreenElement === owned)
                await document.exitFullscreen();
        }
        catch (error) {
            this.ownedFullscreen = owned;
            throw error;
        }
    }
    async request(direction) {
        if (this.busy || this.disposed)
            return;
        const orientation = this.orientation();
        if (typeof orientation?.lock !== 'function') {
            this.status('此浏览器不支持方向锁定，请手动旋转手机，当前页面可继续使用。');
            return;
        }
        this.busy = true;
        const generation = ++this.generation;
        this.status('正在尝试调整屏幕方向…');
        this.update();
        try {
            if (this.dialog.querySelector('#direction-fullscreen').checked && !document.fullscreenElement) {
                await document.documentElement.requestFullscreen();
                this.ownedFullscreen = document.documentElement;
                if (generation !== this.generation || this.disposed) {
                    await this.exitOwnedFullscreen();
                    return;
                }
            }
            await orientation.lock(direction);
            if (generation !== this.generation || this.disposed) {
                orientation.unlock();
                await this.exitOwnedFullscreen();
                return;
            }
            this.locked = true;
            this.status(`已请求锁定${direction === 'landscape' ? '横屏' : '竖屏'}。可用下方按钮恢复自动旋转。`);
        }
        catch {
            try {
                orientation.unlock();
            }
            catch { /* Unsupported or already released. */ }
            this.locked = false;
            try {
                await this.exitOwnedFullscreen();
            }
            catch { /* A separate click can retry exiting. */ }
            this.status(`未能锁定方向。请手动旋转手机；也可勾选全屏后重试，当前页面可继续使用。${this.ownedFullscreen ? '如仍在全屏，请点击下方恢复按钮或用浏览器退出全屏。' : ''}`);
        }
        finally {
            this.busy = false;
            if (!this.disposed)
                this.update();
        }
    }
    async restore() {
        this.generation++;
        try {
            this.orientation()?.unlock();
        }
        catch { /* Also works without the API. */ }
        this.locked = false;
        try {
            await this.exitOwnedFullscreen();
            this.status('已恢复自动旋转。可手动旋转手机，继续游戏。');
        }
        catch {
            this.ownedFullscreen = document.fullscreenElement;
            this.status('已解除方向锁定。请使用浏览器的退出全屏操作恢复正常显示。');
        }
        this.update();
    }
    destroy() {
        this.disposed = true;
        document.removeEventListener('click', this.open, true);
        document.removeEventListener('fullscreenchange', this.fullscreenChanged);
        if (this.busy || this.locked || this.ownedFullscreen)
            void this.restore();
        this.dialog.remove();
    }
}
