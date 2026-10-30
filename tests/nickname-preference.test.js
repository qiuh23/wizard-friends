import test from 'node:test';
import assert from 'node:assert/strict';
import { readNickname, saveNickname } from '../src/nickname-preference.js';

const store = (values = {}) => {
  const data = new Map(Object.entries(values));
  return { getItem:key => data.get(key) ?? null, setItem:(key,value) => data.set(key,String(value)) };
};
const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };

test('browser preference wins over an older tab, including an intentionally cleared name', () => {
  const local = store({'wizard-name':'新名字'}), session = store({'wizard-name':'旧名字'});
  assert.equal(readNickname(local,session),'新名字');
  saveNickname(local,session,'');
  assert.equal(readNickname(local,store({'wizard-name':'旧名字'})),'');
});

test('legacy manual names migrate, while automatic names never become the default', () => {
  const local=store(), session=store({'wizard-name':'老朋友'});
  const name=readNickname(local,session); saveNickname(local,session,name);
  assert.equal(readNickname(local,store()),'老朋友');
  assert.equal(readNickname(store(),store({'wizard-name':'随机名-123','wizard-name-automatic':'true'})),'');
  saveNickname(local,session,'随机名-123',true);
  assert.equal(readNickname(local,session),'');
});

test('name storage failures fall back independently and do not block saving', () => {
  const session=store({'wizard-name':'本页玩家'});
  assert.equal(readNickname(blocked,session),'本页玩家');
  saveNickname(blocked,session,'改名成功');
  assert.equal(readNickname(blocked,session),'改名成功');
  const local=store(); saveNickname(local,blocked,'浏览器玩家');
  assert.equal(readNickname(local,blocked),'浏览器玩家');
  assert.doesNotThrow(()=>saveNickname(blocked,blocked,'玩家'));
  assert.equal(readNickname(blocked,blocked),'');
});
