#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const testsDir = __dirname;
const testFiles = fs
  .readdirSync(testsDir, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.test.js'))
  .map(entry => entry.name)
  .sort((a, b) => a.localeCompare(b));

if (testFiles.length === 0) {
  console.log('No test files found in tests/*.test.js');
  process.exit(0);
}

let failed = 0;

for (const file of testFiles) {
  console.log(`\n==> Running ${file}`);
  const result = spawnSync(process.execPath, ['--test', path.join(testsDir, file)], {
    stdio: 'inherit'
  });

  if (result.error || result.status !== 0) {
    failed += 1;
  }
}

if (failed === 0) {
  console.log(`\nAll tests passed (${testFiles.length} files).`);
  process.exit(0);
}

console.error(`\nTest run failed (${failed}/${testFiles.length} files).`);
process.exit(1);
