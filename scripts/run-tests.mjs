import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const testRoot = path.join(projectRoot, 'tests');
const registration = new URL('./register-test-config.mjs', import.meta.url).href;
const ignoredDirectories = new Set(['fixtures', 'helpers', 'types', 'node_modules']);
const testName = /^(?:test.*|.*(?:-smoke|\.test))\.mjs$/;

async function discover(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) files.push(...await discover(target));
    else if (entry.isFile() && testName.test(entry.name)) files.push(target);
  }
  return files;
}

function runTest(file) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--import', registration, file], {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    child.once('error', error => {
      console.error(`Could not start ${path.relative(projectRoot, file)} (${error.code || 'process error'}).`);
      resolve(false);
    });
    child.once('exit', (code, signal) => {
      if (signal) console.error(`${path.relative(projectRoot, file)} ended with ${signal}.`);
      resolve(code === 0);
    });
  });
}

const tests = (await discover(testRoot)).sort((left, right) => left.localeCompare(right));
if (!tests.length) {
  console.error('No test*.mjs, *-smoke.mjs, or *.test.mjs suites were found.');
  process.exitCode = 1;
} else {
  console.log(`Running ${tests.length} isolated test suites with dummy build configuration.`);
  let passed = 0;
  for (const file of tests) {
    console.log(`\n${path.relative(projectRoot, file)}`);
    if (await runTest(file)) passed++;
  }
  console.log(`\n${passed}/${tests.length} test suites passed.`);
  if (passed !== tests.length) process.exitCode = 1;
}
