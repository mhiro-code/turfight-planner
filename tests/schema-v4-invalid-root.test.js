const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../js/schema-v4.js');

const catalog = { rounds: [{ id: 'round-a' }] };

[
  { name: 'null', value: null },
  { name: '[]', value: [] },
  { name: '"text"', value: 'text' },
  { name: '123', value: 123 },
  { name: 'true', value: true }
].forEach(({ name, value }) => {
  test('migrateToV4():' + name + ' を拒否する', () => {
    const result = schema.migrateToV4(value, catalog);
    assert.equal(result.ok, false);
    assert.match(result.error, /Root/);
  });
});

[
  { name: '"null"', value: 'null' },
  { name: '"[]"', value: '[]' },
  { name: '"\\"text\\""', value: '"text"' },
  { name: '"123"', value: '123' },
  { name: '"true"', value: 'true' }
].forEach(({ name, value }) => {
  test('parseAndMigrateToV4():' + name + ' を拒否する', () => {
    const result = schema.parseAndMigrateToV4(value, catalog);
    assert.equal(result.ok, false);
    assert.match(result.error, /Root/);
  });
});
