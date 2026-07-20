const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../js/schema-v4.js');

function validV4() {
  return {
    schemaVersion: 4,
    activeRecruitmentRoundId: 'round-a',
    recruitmentRounds: {
      'round-a': {
        id: 'round-a',
        settings: { eventBudget: '', voucherAmount: '', bulkRate: '0.9' },
        activePlanId: 'p1',
        plans: [{ id: 'p1', name: 'P1', viewFilter: 'all', horseSelections: {} }]
      }
    }
  };
}

test('storage.getItem(storageKey)例外時はsetItemせず失敗する', () => {
  let setItemCalls = 0;
  const storage = {
    getItem(key) {
      if (key === 'data') throw new Error('read failed');
      return null;
    },
    setItem() {
      setItemCalls += 1;
    }
  };

  const result = schema.writeV4(storage, 'data', 'backup', validV4());

  assert.equal(result.ok, false);
  assert.equal(setItemCalls, 0);
  assert.equal(typeof result.error, 'string');
  assert.notEqual(result.error.length, 0);
});

test('破損JSON保存時は本体もバックアップも書き換えずsetItemしない', () => {
  const original = '{broken';
  const backup = 'existing-backup';
  const values = new Map([
    ['data', original],
    ['backup', backup]
  ]);
  let setItemCalls = 0;
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem() {
      setItemCalls += 1;
    }
  };

  const result = schema.writeV4(storage, 'data', 'backup', validV4());

  assert.equal(result.ok, false);
  assert.equal(values.get('data'), original);
  assert.equal(values.get('backup'), backup);
  assert.equal(setItemCalls, 0);
  assert.equal(typeof result.error, 'string');
  assert.notEqual(result.error.length, 0);
});

test('storage.setItem(storageKey)例外時は既存本体文字列を維持する', () => {
  const original = JSON.stringify(validV4());
  const values = new Map([
    ['data', original]
  ]);
  let setItemCalls = 0;
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem(key, value) {
      setItemCalls += 1;
      if (key === 'data') throw new Error('write failed');
      values.set(key, value);
    }
  };

  const next = validV4();
  next.recruitmentRounds['round-a'].plans[0].name = 'Updated';

  const result = schema.writeV4(storage, 'data', 'backup', next);

  assert.equal(result.ok, false);
  assert.equal(values.get('data'), original);
  assert.equal(setItemCalls, 1);
  assert.equal(typeof result.error, 'string');
  assert.notEqual(result.error.length, 0);
});
