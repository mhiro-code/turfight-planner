const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../js/schema-v4.js');

const catalog = { rounds: [{ id: 'round-a' }] };

test('RootがObjectではない場合を拒否する', () => {
  assert.equal(schema.migrateToV4(null, catalog).ok, false);
  assert.match(schema.migrateToV4(null, catalog).error, /Root/);
});

test('RootがArrayの場合を拒否する', () => {
  const result = schema.migrateToV4([], catalog);
  assert.equal(result.ok, false);
  assert.match(result.error, /Root/);
});

test('recruitmentRoundsがArrayの場合を拒否する', () => {
  const result = schema.migrateToV4({
    schemaVersion: 4,
    activeRecruitmentRoundId: 'round-a',
    recruitmentRounds: []
  }, catalog);
  assert.equal(result.ok, false);
  assert.match(result.error, /recruitmentRounds/);
});

test('recruitmentRoundsがnullの場合を拒否する', () => {
  const result = schema.migrateToV4({
    schemaVersion: 4,
    activeRecruitmentRoundId: 'round-a',
    recruitmentRounds: null
  }, catalog);
  assert.equal(result.ok, false);
  assert.match(result.error, /recruitmentRounds/);
});

test('activeRecruitmentRoundIdが欠落している場合を拒否する', () => {
  const result = schema.migrateToV4({
    schemaVersion: 4,
    recruitmentRounds: {
      'round-a': {
        id: 'round-a',
        settings: {},
        activePlanId: 'p1',
        plans: [{ id: 'p1', name: 'P1', viewFilter: 'all', horseSelections: {} }]
      }
    }
  }, catalog);
  assert.equal(result.ok, false);
  assert.match(result.error, /activeRecruitmentRoundId/);
});
