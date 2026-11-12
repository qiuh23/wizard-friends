import test from 'node:test';
import assert from 'node:assert/strict';
import { bindBidControls } from '../src/bid-controls.js';

function fixture({ count = 21, height = 390, width = 340, disabled = [] } = {}) {
  const listeners = {}, styles = {};
  let focused, disconnected = false;
  const buttons = Array.from({ length: count }, (_, value) => ({
    disabled: disabled.includes(value),
    focus() { focused = value; },
    scrollIntoView() {},
  }));
  globalThis.innerHeight = height;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.ResizeObserver = class { observe() {} disconnect() { disconnected = true; } };
  const root = { clientWidth: width, scrollWidth: count * 50 + 2, scrollLeft: 0, dataset: {},
    style: { setProperty(key, value) { styles[key] = value; } },
    querySelectorAll() { return buttons; }, addEventListener(key, cb) { listeners[key] = cb; },
  };
  bindBidControls(root);
  return { root, styles, buttons, listeners, focused: () => focused, disconnected: () => disconnected,
    key(key, index) { listeners.keydown({ key, target: buttons[index], preventDefault() {} }); } };
}

test('short landscape retains one scrollable row and all long-round options', () => {
  const f = fixture();
  assert.equal(f.styles['--bid-columns'], '21');
  assert.equal(f.root.dataset.after, 'true');
  f.key('End', 0); assert.equal(f.focused(), 20);
  f.key('Home', 20); assert.equal(f.focused(), 0);
  f.root._disposeBidControls(); assert.equal(f.disconnected(), true);
});

test('tall screens use two rows only when options need the space', () => {
  assert.equal(fixture({ height: 844 }).styles['--bid-columns'], '11');
  assert.equal(fixture({ count: 2, height: 844 }).styles['--bid-columns'], '2');
});

test('arrow and boundary navigation skip disabled options, without changing bids', () => {
  const f = fixture({ count: 6, disabled: [0, 2, 5] });
  f.key('ArrowRight', 1); assert.equal(f.focused(), 3);
  f.key('ArrowLeft', 3); assert.equal(f.focused(), 1);
  f.key('End', 1); assert.equal(f.focused(), 4);
  f.key('Home', 4); assert.equal(f.focused(), 1);
  f.buttons.forEach(b => { b.disabled = true; });
  assert.doesNotThrow(() => f.key('End', 1));
});

test('wheel scroll remains local to the overflowing bid group', () => {
  const f = fixture(); let prevented = false;
  f.listeners.wheel({ deltaX: 0, deltaY: 3, deltaMode: 1, preventDefault() { prevented = true; } });
  assert.equal(f.root.scrollLeft, 60); assert.equal(prevented, true);
  f.listeners.scroll(); assert.equal(f.root.dataset.before, 'true');
});
