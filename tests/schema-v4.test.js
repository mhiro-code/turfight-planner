const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../js/schema-v4.js');

const catalog = { rounds: [{ id: 'round-a', name: '募集回A' }, { id: 'round-b', name: '募集回B' }] };

function v3Plan(id, roundIds, settings = {}) {
  const recruitmentRounds = {};
  roundIds.forEach((roundId, index) => {
    recruitmentRounds[roundId] = { id: roundId, horses: { [index + 1]: { units: index + 1, memo: id + '-' + roundId } } };
  });
  return { id, name: id, viewFilter: 'selected', recruitmentRounds, ...settings };
}

test('schemaVersionなしを単一募集回・default Planへ移行する', () => {
  const result = schema.migrateToV4({ horses: { 1: { units: 2, memo: '候補' } }, eventBudget: '1000' }, catalog);
  assert.equal(result.ok, true);
  assert.equal(result.data.schemaVersion, 4);
  assert.equal(result.data.recruitmentRounds['round-a'].plans[0].horseSelections[1].units, 2);
  assert.equal(result.data.recruitmentRounds['round-a'].settings.eventBudget, '1000');
});

test('schemaVersion 2以前を移行する', () => {
  const result = schema.migrateToV4({ schemaVersion: 2, activeRecruitmentRoundId: 'old', viewFilter: 'selected', horses: {} }, catalog);
  assert.equal(result.ok, true);
  assert.equal(result.data.activeRecruitmentRoundId, 'old');
  assert.equal(result.data.recruitmentRounds.old.plans[0].viewFilter, 'selected');
});

test('v3単一PlanのhorsesとviewFilterを保持する', () => {
  const raw = { schemaVersion: 3, activePlanId: 'p1', plans: [v3Plan('p1', ['round-a'])] };
  const result = schema.migrateToV4(raw, catalog);
  const plan = result.data.recruitmentRounds['round-a'].plans[0];
  assert.equal(plan.id, 'p1');
  assert.equal(plan.viewFilter, 'selected');
  assert.equal(plan.horseSelections[1].memo, 'p1-round-a');
});

test('v3複数Plan・複数募集回の全選択を保持する', () => {
  const raw = { schemaVersion: 3, activePlanId: 'p2', plans: [v3Plan('p1', ['round-a', 'round-b']), v3Plan('p2', ['round-a', 'round-b'])] };
  const result = schema.migrateToV4(raw, catalog);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.data.recruitmentRounds).sort(), ['round-a', 'round-b']);
  assert.equal(result.data.recruitmentRounds['round-a'].plans.length, 2);
  assert.equal(result.data.recruitmentRounds['round-b'].plans.length, 2);
  assert.equal(result.data.recruitmentRounds['round-b'].plans[1].horseSelections[2].memo, 'p2-round-b');
});

test('v3募集回設定の競合を決定的に解決し診断する', () => {
  const raw = {
    schemaVersion: 3,
    activePlanId: 'p2',
    plans: [
      v3Plan('p1', ['round-a'], { eventBudget: '100' }),
      v3Plan('p2', ['round-a'], { eventBudget: '200' })
    ]
  };
  const first = schema.migrateToV4(raw, { rounds: [{ id: 'round-a' }] });
  const second = schema.migrateToV4(raw, { rounds: [{ id: 'round-a' }] });
  assert.equal(first.data.recruitmentRounds['round-a'].settings.eventBudget, '200');
  assert.deepEqual(first, second);
  assert.equal(first.diagnostics[0].code, 'recruitment-round-settings-conflict');
});

test('v4移行は冪等で未知フィールドも保持する', () => {
  const v4 = {
    schemaVersion: 4,
    activeRecruitmentRoundId: 'round-a',
    custom: 'keep',
    recruitmentRounds: {
      'round-a': { id: 'round-a', settings: { eventBudget: '' }, activePlanId: 'p1', plans: [{ id: 'p1', name: 'P1', viewFilter: 'all', horseSelections: {} }] }
    }
  };
  const result = schema.migrateToV4(v4, catalog);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, v4);
});

test('破損JSONと将来Versionを拒否する', () => {
  assert.equal(schema.parseAndMigrateToV4('{broken', catalog).ok, false);
  assert.equal(schema.migrateToV4({ schemaVersion: 5 }, catalog).ok, false);
});

test('必須ID欠落・ID重複・コレクション型不正を拒否する', () => {
  const invalid = {
    schemaVersion: 4,
    activeRecruitmentRoundId: 'round-a',
    recruitmentRounds: {
      'round-a': { id: 'round-a', settings: {}, activePlanId: 'p1', plans: [
        { id: 'p1', horseSelections: {} }, { id: 'p1', horseSelections: [] }
      ] }
    }
  };
  const result = schema.validateV4(invalid);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /重複/);
  assert.match(result.errors.join('\n'), /horseSelections/);
});

test('バックアップ失敗時は本体を書き換えない', () => {
  const original = JSON.stringify({ schemaVersion: 3, plans: [] });
  const values = new Map([['data', original]]);
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem(key, value) {
      if (key === 'backup') throw new Error('quota');
      values.set(key, value);
    }
  };
  const data = schema.migrateToV4({}, { rounds: [{ id: 'round-a' }] }).data;
  const result = schema.writeV4(storage, 'data', 'backup', data);
  assert.equal(result.ok, false);
  assert.equal(values.get('data'), original);
});

test('初回v4書込み前に元文字列を一度だけバックアップする', () => {
  const original = JSON.stringify({ schemaVersion: 3, plans: [] });
  const values = new Map([['data', original]]);
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value)
  };
  const data = schema.migrateToV4({}, { rounds: [{ id: 'round-a' }] }).data;
  assert.equal(schema.writeV4(storage, 'data', 'backup', data).ok, true);
  assert.equal(values.get('backup'), original);
  values.set('data', original);
  assert.equal(schema.writeV4(storage, 'data', 'backup', data).ok, true);
  assert.equal(values.get('backup'), original);
});
