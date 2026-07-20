const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../js/schema-v4.js');

const validData = {
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
};

test('getItemが例外を投げる場合、ok === falseでsetItemは呼ばれない', () => {
  const setItemKeys = [];
  const storage = {
    getItem(key) { throw new Error('storage unavailable'); },
    setItem(key, value) { setItemKeys.push(key); }
  };
  const result = schema.writeV4(storage, 'data', 'backup', validData);
  assert.equal(result.ok, false);
  assert.equal(setItemKeys.length, 0);
});

test('保存済み本体が破損JSONの場合、ok === falseで本体・バックアップを書き換えない', () => {
  const setItemKeys = [];
  const storage = {
    getItem(key) { return key === 'data' ? '{invalid json' : null; },
    setItem(key, value) { setItemKeys.push(key); }
  };
  const result = schema.writeV4(storage, 'data', 'backup', validData);
  assert.equal(result.ok, false);
  assert.equal(setItemKeys.length, 0);
});

test('setItem(storageKey)が値を変更する前に例外を投げる場合、ok === falseで既存の本体文字列を維持する', () => {
  const originalBody = JSON.stringify(validData);
  const values = new Map([['data', originalBody]]);
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (key === 'data') throw new Error('quota exceeded');
      values.set(key, value);
    }
  };
  const result = schema.writeV4(storage, 'data', 'backup', validData);
  assert.equal(result.ok, false);
  assert.equal(values.get('data'), originalBody);
});
