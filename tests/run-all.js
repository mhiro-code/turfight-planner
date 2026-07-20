#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { run } = require('node:test');
const { spec } = require('node:test/reporters');

async function main() {
  const testsDir = __dirname;
  const testFiles = fs
    .readdirSync(testsDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.js'))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (testFiles.length === 0) {
    console.error('No test files found in tests/*.test.js');
    process.exitCode = 1;
    return;
  }

  console.log(`Running ${testFiles.length} test file(s):`);
  for (const file of testFiles) {
    console.log(`- ${file}`);
  }
  console.log('');

  const files = testFiles.map(file => path.join(testsDir, file));
  let failed = 0;
  let executionError = null;

  const stream = run({
    files,
    isolation: 'none',
    concurrency: false
  });

  stream.on('test:fail', () => {
    failed += 1;
  });
  stream.on('error', error => {
    executionError = error;
  });

  stream.compose(spec()).pipe(process.stdout);
  await once(stream, 'end');

  if (executionError) {
    console.error(`\nTest run could not complete: ${executionError.message}`);
    process.exitCode = 1;
    return;
  }

  if (failed === 0) {
    console.log(`\nAll tests passed (${testFiles.length} files).`);
    process.exitCode = 0;
    return;
  }

  console.error(`\nTest run failed (${failed} failure${failed === 1 ? '' : 's'}).`);
  process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
