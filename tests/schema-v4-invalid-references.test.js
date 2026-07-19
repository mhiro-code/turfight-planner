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

test('recruitmentRoundsのMapキーとRecruitmentRound.id不一致を拒否する', () => {
  const data = validV4();
  data.recruitmentRounds['round-a'].id = 'round-x';

  const result = schema.migrateToV4(data, { rounds: [{ id: 'round-a' }] });
  assert.equal(result.ok, false);
  assert.equal(result.error, '募集回IDが欠落またはMapキーと不一致です: round-a');
});

test('plansが空配列の募集回を拒否する', () => {
  const data = validV4();
  data.recruitmentRounds['round-a'].plans = [];

  const result = schema.migrateToV4(data, { rounds: [{ id: 'round-a' }] });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'plansが空またはArrayではありません: round-a');
});

test('activePlanIdが存在しないPlan参照を拒否する', () => {
  const data = validV4();
  data.recruitmentRounds['round-a'].activePlanId = 'missing-plan';

  const result = schema.migrateToV4(data, { rounds: [{ id: 'round-a' }] });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'activePlanIdが募集回内のPlanを参照していません: round-a');
});

test('activeRecruitmentRoundIdが存在しない募集回参照を拒否する', () => {
  const data = validV4();
  data.activeRecruitmentRoundId = 'missing-round';

  const result = schema.migrateToV4(data, { rounds: [{ id: 'round-a' }] });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'activeRecruitmentRoundIdが存在する募集回を参照していません');
});

test('settingsがObjectではない募集回を拒否する', () => {
  const data = validV4();
  data.recruitmentRounds['round-a'].settings = [];

  const result = schema.migrateToV4(data, { rounds: [{ id: 'round-a' }] });
  assert.equal(result.ok, false);
  assert.equal(result.error, '募集回設定がObjectではありません: round-a');
});
