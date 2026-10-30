import { frameScheduler } from './frame-scheduler.js';

/** Coalesce layout invalidations before the scene's frame, keeping forced work. */
export function createLayoutScheduler(update, { scheduler = frameScheduler } = {}) {
  let force = false, disposed = false;
  const run = () => {
    const options = { force };
    force = false;
    return update(options);
  };
  const client = scheduler.add(() => { run(); return null; }, { priority: -10 });
  return {
    request(options = {}) {
      if (disposed) return;
      force ||= !!options.force;
      client.request();
    },
    flush(options = {}) {
      if (disposed) return false;
      force ||= !!options.force;
      client.cancel();
      return run();
    },
    cancel() { force = false; client.cancel(); },
    dispose() { disposed = true; force = false; client.dispose(); },
  };
}
