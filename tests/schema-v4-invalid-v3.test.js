const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../js/schema-v4.js');

const catalog = { rounds: [{ id: 'round-a' }] };

test('v3の必須Plan ID欠落を拒否する', () => {
  const result = schema.migrateToV4({ schemaVersion: 3, plans: [{ recruitmentRounds: {} }] }, catalog);
  assert.equal(result.ok, false);
  assert.match(result.error, /Plan ID/);
});

test('v3の募集回コレクション型不正を拒否する', () => {
  const result = schema.migrateToV4({ schemaVersion: 3, plans: [{ id: 'p1', recruitmentRounds: [] }] }, catalog);
  assert.equal(result.ok, false);
  assert.match(result.error, /recruitmentRounds/);
});

test('v3のhorses型不正を拒否する', () => {
  const result = schema.migrateToV4({
    schemaVersion: 3,
    plans: [{ id: 'p1', recruitmentRounds: { 'round-a': { id: 'round-a', horses: [] } } }]
  }, catalog);
  assert.equal(result.ok, false);
  assert.match(result.error, /horses/);
});
