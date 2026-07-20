const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../js/schema-v4.js');

const catalog = { rounds: [{ id: 'round-a' }] };

function validData() {
  return schema.migrateToV4({}, catalog).data;
}

test('getItem(storageKey)が例外を投げる場合、ok===falseでsetItemが呼ばれない', () => {
  const setItemCalls = [];
  const storage = {
    getItem() { throw new Error('storage unavailable'); },
    setItem(key, value) { setItemCalls.push({ key, value }); }
  };
  const result = schema.writeV4(storage, 'data', 'backup', validData());
  assert.equal(result.ok, false);
  assert.equal(setItemCalls.length, 0);
});

test('保存済み本体が破損JSONの場合、ok===falseで本体・バックアップを書き換えない', () => {
  const corrupted = '{broken';
  const setItemCalls = [];
  const values = new Map([['data', corrupted]]);
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { setItemCalls.push({ key, value }); values.set(key, value); }
  };
  const result = schema.writeV4(storage, 'data', 'backup', validData());
  assert.equal(result.ok, false);
  assert.equal(setItemCalls.length, 0);
  assert.equal(values.get('data'), corrupted);
  assert.equal(values.has('backup'), false);
});

test('setItem(storageKey)が値を変更する前に例外を投げる場合、ok===falseで既存本体文字列を維持する', () => {
  const existing = JSON.stringify({
    schemaVersion: 4,
    activeRecruitmentRoundId: 'round-a',
    recruitmentRounds: {
      'round-a': {
        id: 'round-a',
        settings: { eventBudget: '', voucherAmount: '', bulkRate: '0.9' },
        activePlanId: 'p1',
        plans: [{ id: 'p1', name: 'プラン1', viewFilter: 'all', horseSelections: {} }]
      }
    }
  });
  const values = new Map([['data', existing]]);
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (key === 'data') throw new Error('write failed');
      values.set(key, value);
    }
  };
  const result = schema.writeV4(storage, 'data', 'backup', validData());
  assert.equal(result.ok, false);
  assert.equal(values.get('data'), existing);
});
