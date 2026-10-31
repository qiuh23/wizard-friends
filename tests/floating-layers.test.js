import test from 'node:test';
import assert from 'node:assert/strict';
import { FloatingLayers, containsEvent } from '../src/floating-layers.js';

function fixture(options) {
  const layers = ['menu', 'scores', 'chat'].map(id => ({
    id, open:false, focus:0, panel:{}, trigger:{},
    isOpen() { return this.open; },
    contains(event) { return containsEvent(event, [this.panel, this.trigger]); },
    close({restoreFocus}) { this.open = false; this.focus += Number(restoreFocus); },
  }));
  const controller = new FloatingLayers(layers, options);
  const click = (node, extra = {}) => controller.click({button:0,composedPath:() => [node],...extra});
  return {controller, layers, click};
}

test('inside interaction retains a panel; an outside click dismisses without consuming the action', () => {
  const {layers:[menu], click} = fixture();
  menu.open = true;
  click(menu.panel);
  assert.equal(menu.open, true);
  let consumed = false;
  click({}, {preventDefault:() => { consumed = true; },stopPropagation:() => { consumed = true; }});
  assert.equal(menu.open, false);
  assert.equal(consumed, false);
  assert.equal(menu.focus, 0, 'outside dismissal keeps focus on the clicked control');
});

test('a trigger remains part of its layer so its own handler can toggle it exactly once', () => {
  const {layers:[menu, scores], click} = fixture();
  menu.open = true;
  click(menu.trigger); menu.open = !menu.open;
  assert.equal(menu.open, false);
  menu.open = true;
  click(scores.trigger); scores.open = !scores.open;
  assert.equal(menu.open, false);
  assert.equal(scores.open, true);
  click(menu.trigger); menu.open = !menu.open;
  assert.equal(scores.open, false);
  assert.equal(menu.open, true);
});

test('replaced game nodes and shadow paths retain inside-click behavior', () => {
  const {layers:[menu], click} = fixture();
  const oldPanel = menu.panel;
  menu.panel = {}; menu.open = true;
  click(menu.panel);
  assert.equal(menu.open, true);
  click(oldPanel);
  assert.equal(menu.open, false);
  const target = {};
  assert.equal(containsEvent({target}, [{contains:node => node === target}]), true);
});

test('Esc dismisses and restores focus, while handled keys and modal interactions stay protected', () => {
  let blocked = false;
  const {controller,layers:[menu],click} = fixture({blocked:() => blocked});
  menu.open = true;
  let prevented = false;
  const event = {key:'Escape',preventDefault:() => { prevented = true; }};
  controller.keydown({...event,defaultPrevented:true});
  assert.equal(menu.open, true);
  blocked = true;
  controller.keydown(event); click({});
  assert.equal(menu.open, true);
  assert.equal(prevented, false);
  blocked = false;
  controller.keydown(event);
  assert.equal(menu.open, false);
  assert.equal(menu.focus, 1);
  assert.equal(prevented, true);
});

test('a swipe or secondary click cannot be mistaken for a tap outside', () => {
  let dragged = true;
  const {layers:[menu],click} = fixture({ignoreClick:() => dragged});
  menu.open = true; click({});
  assert.equal(menu.open, true);
  dragged = false; click({}, {button:2});
  assert.equal(menu.open, true);
  click({});
  assert.equal(menu.open, false);
});
