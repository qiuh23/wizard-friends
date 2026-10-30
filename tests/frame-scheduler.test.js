import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameScheduler } from '../src/frame-scheduler.js';

function setup() {
  let now = 0, id = 0;
  const frames = new Map(), timers = new Map();
  const scheduler = new FrameScheduler({ now: () => now,
    requestFrame: callback => { frames.set(++id, callback); return id; }, cancelFrame: id => frames.delete(id),
    setTimer: (callback, delay) => { timers.set(++id, { callback, at: now + delay }); return id; }, clearTimer: id => timers.delete(id),
  });
  return { scheduler, frames, timers,
    advance(ms) { now += ms; },
    frame() { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(now); },
    timersDue() { for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); } },
  };
}

test('layout, HTML and WebGL share a frame while repeated requests and idle clients do no extra work', () => {
  const s = setup(), calls = [];
  const scene = s.scheduler.add(time => { calls.push(['scene', time]); return null; }, {priority:10});
  const html = s.scheduler.add(time => { calls.push(['html', time]); return null; });
  const layout = s.scheduler.add(time => {
    calls.push(['layout', time]); s.advance(5); scene.request(); return null;
  }, {priority:-10});
  layout.request(); layout.request(); html.request(); html.request();
  assert.equal(s.frames.size, 1);
  s.advance(16); s.frame();
  assert.deepEqual(calls, [['layout',16],['html',16],['scene',16]]);
  assert.equal(s.frames.size, 0); assert.equal(s.timers.size, 0);
  s.advance(1000); s.frame(); assert.equal(calls.length, 3);
});

test('a future collection wakes without a permanent RAF and new state brings it forward', () => {
  const s = setup(); let draws = 0;
  const client = s.scheduler.add(() => { draws++; return draws === 1 ? 1000 : null; });
  client.request(); s.frame();
  assert.equal(draws, 1); assert.equal(s.frames.size, 0); assert.equal(s.timers.size, 1);
  s.advance(984); s.timersDue(); assert.equal(s.frames.size, 1);
  s.advance(16); s.frame();
  assert.equal(draws, 2); assert.equal(s.frames.size, 0); assert.equal(s.timers.size, 0);
  const later = s.scheduler.add(() => { draws++; return null; });
  later.request(5000); assert.equal(s.timers.size, 1);
  later.request(); assert.equal(s.timers.size, 0); assert.equal(s.frames.size, 1);
  s.frame(); assert.equal(draws, 3);
});

test('background suspension stops pending work and refreshes once on return; disposed clients stay stopped', () => {
  const s = setup(); let draws = 0;
  const client = s.scheduler.add(() => { draws++; return null; });
  client.request(); s.scheduler.setSuspended(true);
  assert.equal(s.frames.size, 0); assert.equal(s.timers.size, 0);
  s.advance(10000); s.scheduler.setSuspended(false); s.frame();
  assert.equal(draws, 1); assert.equal(s.frames.size, 0);
  client.request(1000); client.dispose();
  assert.equal(s.frames.size, 0); assert.equal(s.timers.size, 0);
  s.scheduler.setSuspended(false); s.frame(); assert.equal(draws, 1);
});
