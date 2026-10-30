import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutScheduler } from '../src/layout-scheduler.js';

function scheduler() {
  let callback, queued = false;
  return {
    add(draw, options) {
      assert.equal(options.priority, -10); callback = draw;
      return { request() { queued = true; }, cancel() { queued = false; }, dispose() { queued = false; } };
    },
    frame() { if (queued) { queued = false; callback(100); } },
  };
}

test('observer and structural requests share one frame and retain forced layout', () => {
  const frames = scheduler(), calls = [];
  const layout = createLayoutScheduler(options => calls.push(options), { scheduler: frames });
  layout.request(); layout.request({ force: true }); layout.request();
  frames.frame(); frames.frame();
  assert.deepEqual(calls, [{ force: true }]);
  layout.request(); frames.frame();
  assert.deepEqual(calls, [{ force: true }, { force: false }]);
});

test('synchronous layout consumes pending work and disposed layouts stay inactive', () => {
  const frames = scheduler(), calls = [];
  const layout = createLayoutScheduler(options => { calls.push(options); return true; }, { scheduler: frames });
  layout.request({ force: true });
  assert.equal(layout.flush(), true); frames.frame();
  assert.deepEqual(calls, [{ force: true }]);
  layout.request(); layout.cancel(); frames.frame();
  layout.dispose(); layout.request({ force: true }); frames.frame();
  assert.equal(layout.flush(), false);
  assert.equal(calls.length, 1);
});
