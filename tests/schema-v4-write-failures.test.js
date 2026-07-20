const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../js/schema-v4.js');

function validV4Data() {
  return {
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
}

test('getItem(storageKey)が例外を投げる場合ok===falseでsetItemが呼ばれない', () => {
  let setItemCalled = false;
  const storage = {
    getItem(key) {
      if (key === 'data') throw new Error('read failure');
      return null;
    },
    setItem(_key, _value) {
      setItemCalled = true;
    }
  };
  const result = schema.writeV4(storage, 'data', 'backup', validV4Data());
  assert.equal(result.ok, false);
  assert.equal(setItemCalled, false);
});

test('保存済み本体が破損JSONの場合ok===falseで本体もバックアップも書き換えずsetItemが呼ばれない', () => {
  const corruptBody = '{broken';
  let setItemCalled = false;
  const values = new Map([['data', corruptBody]]);
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem(key, value) {
      setItemCalled = true;
      values.set(key, value);
    }
  };
  const result = schema.writeV4(storage, 'data', 'backup', validV4Data());
  assert.equal(result.ok, false);
  assert.equal(setItemCalled, false);
  assert.equal(values.get('data'), corruptBody);
  assert.equal(values.has('backup'), false);
});

test('setItem(storageKey)が例外を投げる場合ok===falseで既存の本体文字列を維持する', () => {
  const original = JSON.stringify(validV4Data());
  const values = new Map([['data', original]]);
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem(key, value) {
      if (key === 'data') throw new Error('write failure');
      values.set(key, value);
    }
  };
  const newData = validV4Data();
  newData.recruitmentRounds['round-a'].settings.eventBudget = '9999';
  const result = schema.writeV4(storage, 'data', 'backup', newData);
  assert.equal(result.ok, false);
  assert.equal(values.get('data'), original);
});
