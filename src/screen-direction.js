const MANUAL = '横屏：请关闭系统竖屏锁定后手动旋转手机。';
const FAILED = '浏览器未能开启横屏，请关闭系统竖屏锁定后手动旋转手机。';
const EXIT_FAILED = '请重试退出横屏，或使用浏览器的退出全屏操作。';
export class ScreenDirection {
    session = null;
    unavailable = false;
    message = '';
    disposed = false;
    observer = new MutationObserver(records => {
        // Menus may be recreated by the existing renderer. Only sync new controls,
        // not every animation, countdown, chat message or text mutation.
        if (records.some(record => [...record.addedNodes].some(node => node instanceof Element &&
            (node.matches('[data-landscape-control]') || node.querySelector('[data-landscape-control]')))))
            this.update();
    });
    constructor() {
        document.addEventListener('click', this.toggle, true);
        document.addEventListener('fullscreenchange', this.fullscreenChanged);
        window.addEventListener('pagehide', this.pageHidden);
        this.observer.observe(document.body, { childList: true, subtree: true });
        this.update();
    }
    orientation() { return screen.orientation; }
    supported() {
        return typeof this.orientation()?.lock === 'function' && typeof this.orientation()?.unlock === 'function' &&
            (!!document.fullscreenElement || (document.fullscreenEnabled &&
                typeof document.documentElement.requestFullscreen === 'function' && typeof document.exitFullscreen === 'function'));
    }
    update() {
        if (this.disposed)
            return;
        const available = !!this.session || (!this.unavailable && this.supported());
        document.querySelectorAll('[data-landscape-control]').forEach(control => {
            const button = control.querySelector('[data-screen-direction]');
            const hint = control.querySelector('[data-landscape-help]');
            const label = this.session ? '退出横屏' : '横屏';
            if (button.textContent !== label)
                button.textContent = label;
            button.hidden = !available;
            button.disabled = !!this.session?.cancelled && this.session.pending;
            button.setAttribute('aria-pressed', String(!!this.session && !this.session.cancelled));
            button.setAttribute('aria-busy', String(!!this.session?.pending || !!this.session?.cleanup));
            const message = this.message || (!available ? MANUAL : '');
            if (hint.textContent !== message)
                hint.textContent = message;
            hint.hidden = !message;
        });
    }
    toggle = (event) => {
        const button = event.target?.closest('[data-screen-direction]');
        if (!button || button.hidden || button.disabled)
            return;
        event.preventDefault();
        if (this.session)
            void this.restore();
        else
            void this.enter();
    };
    fullscreenChanged = () => {
        const session = this.session;
        if (session?.fullscreen && document.fullscreenElement !== session.fullscreen && !session.cancelled)
            void this.restore();
        else if (session?.cancelled && !session.pending && !session.cleanup && document.fullscreenElement !== session.fullscreen) {
            // The browser can dismiss fullscreen after our own exit request failed.
            if (this.message === EXIT_FAILED)
                this.message = '';
            void this.release(session);
        }
        else
            this.update();
    };
    pageHidden = () => { void this.restore(); };
    unlock(session) {
        if (!session.needsUnlock)
            return;
        session.needsUnlock = false;
        try {
            session.orientation.unlock();
        }
        catch { /* Exiting fullscreen also releases the browser lock. */ }
    }
    release(session) {
        if (session.cleanup)
            return session.cleanup;
        session.cleanup = Promise.resolve().then(async () => {
            this.unlock(session);
            try {
                // Never exit fullscreen that was already present before this click, or
                // another element's fullscreen entered after our own was dismissed.
                if (session.owned && document.fullscreenElement === session.owned)
                    await document.exitFullscreen();
                session.owned = null;
            }
            catch {
                if (document.fullscreenElement !== session.owned)
                    session.owned = null;
                else
                    this.message = EXIT_FAILED;
            }
            this.unlock(session);
        }).then(() => {
            session.cleanup = undefined;
            if (!session.pending && !session.owned && this.session === session)
                this.session = null;
            this.update();
        });
        return session.cleanup;
    }
    async enter() {
        if (this.session || this.disposed || this.unavailable || !this.supported())
            return;
        const session = {
            orientation: this.orientation(), fullscreen: document.fullscreenElement, owned: null,
            pending: true, cancelled: false, needsUnlock: false,
        };
        this.session = session;
        this.message = '';
        this.update();
        try {
            if (!session.fullscreen) {
                // Called directly in the click gesture, before yielding to a promise.
                await document.documentElement.requestFullscreen();
                session.fullscreen = session.owned = document.documentElement;
            }
            if (session.cancelled || this.disposed)
                return;
            if (document.fullscreenElement !== session.fullscreen)
                throw new Error('Fullscreen ended');
            session.needsUnlock = true;
            await session.orientation.lock('landscape');
            // A late resolution must be unlocked even if Exit was clicked meanwhile.
            session.needsUnlock = true;
            if (document.fullscreenElement !== session.fullscreen)
                session.cancelled = true;
        }
        catch {
            if (!session.cancelled && !this.disposed) {
                this.unavailable = true;
                this.message = FAILED;
            }
            session.cancelled = true;
        }
        finally {
            session.pending = false;
            if (session.cancelled || this.disposed) {
                // An earlier cancellation may have run before fullscreen/lock resolved.
                if (session.cleanup)
                    await session.cleanup;
                await this.release(session);
            }
            this.update();
        }
    }
    async restore() {
        const session = this.session;
        if (!session)
            return;
        session.cancelled = true;
        this.message = '';
        this.update();
        await this.release(session);
    }
    destroy() {
        this.disposed = true;
        this.observer.disconnect();
        document.removeEventListener('click', this.toggle, true);
        document.removeEventListener('fullscreenchange', this.fullscreenChanged);
        window.removeEventListener('pagehide', this.pageHidden);
        void this.restore();
    }
}
export const screenDirectionControlHTML = "<span class=\"landscape-control\" data-landscape-control><button type=\"button\" data-screen-direction aria-pressed=\"false\">横屏</button><small class=\"landscape-help\" data-landscape-help role=\"status\" aria-live=\"polite\" hidden></small></span>";
