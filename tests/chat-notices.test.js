import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatNotices, CHAT_NOTICE_MS, CHAT_NOTICE_EXIT_MS } from '../src/chat-notices.js';
const message = seq => ({ seq, player: 'other', name: '消息昵称', text: `消息${seq}` });
test('history, duplicate renders, own messages and reconnect backlog do not pop up', () => {
  const feed = new ChatNotices();
  assert.deepEqual(feed.update([message(1)], 'self', true, 0), []);
  feed.update([message(1), message(2)], 'self', true, 100);
  assert.deepEqual(feed.items.map(n => n.message.seq), [2]);
  feed.update([message(2)], 'self', true, 200);
  assert.equal(feed.items[0].expiresAt, 100 + CHAT_NOTICE_MS);
  feed.update([{ ...message(3), player: 'self' }], 'self', true, 300);
  assert.equal(feed.items.length, 1);
  feed.update([message(4)], 'self', false, 400);
  assert.equal(feed.items.length, 0);
  feed.update([message(5)], 'self', true, 500);
  assert.equal(feed.items.length, 0);
  feed.update([message(6)], 'self', true, 600);
  assert.deepEqual(feed.items.map(n => n.message.seq), [6]);
});
test('each message lasts eight seconds independently, fades and expires without changing history', () => {
  const feed = new ChatNotices(), history = [message(1)];
  feed.update([], 'self', true, 0);
  feed.update(history, 'self', true, 1000);
  feed.update([...history, message(2)], 'self', true, 5000);
  assert.deepEqual(feed.advance(9000).map(n => n.leaving), [true, false]);
  assert.deepEqual(feed.advance(9000 + CHAT_NOTICE_EXIT_MS).map(n => n.message.seq), [2]);
  assert.equal(history[0].text, '消息1'); assert.equal(history.length, 1);
});
test('bounded desktop and mobile stacks retain chronological order and reset between rooms', () => {
  const feed = new ChatNotices(); feed.update([], 'self', true, 0);
  feed.update(Array.from({ length: 10 }, (_, i) => message(i + 1)), 'self', true, 1, 5);
  assert.deepEqual(feed.items.map(n => n.message.seq), [6,7,8,9,10]);
  assert.deepEqual(feed.advance(2, 3).map(n => n.message.seq), [8,9,10]);
  feed.reset(); assert.equal(feed.latest, 0); assert.equal(feed.items.length, 0);
});
