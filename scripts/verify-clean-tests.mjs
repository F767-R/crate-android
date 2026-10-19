import assert from 'node:assert/strict';
import { cp, lstat, mkdtemp, rm, symlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const temporaryRoot = path.resolve(tmpdir());
const sandbox = await mkdtemp(path.join(temporaryRoot, 'crate-tests-'));
const generatedRoot = path.join(projectRoot, 'src', 'generated');

async function missing(file) {
  try { await lstat(file); return false; }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}

try {
  // Copy only source/test tooling, and never traverse generated configuration.
  for (const name of ['package.json', 'src', 'scripts', 'tests']) {
    await cp(path.join(projectRoot, name), path.join(sandbox, name), {
      recursive: true,
      filter: source => source !== generatedRoot && !source.startsWith(generatedRoot + path.sep),
    });
  }
  // Reuse installed packages read-only; the test runner never installs anything.
  await symlink(path.join(projectRoot, 'node_modules'), path.join(sandbox, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(await missing(path.join(sandbox, 'secrets.txt')), true);
  assert.equal(await missing(path.join(sandbox, 'src', 'generated')), true);

  console.log('Verifying tests in an isolated checkout without secrets.txt or generated config.');
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(sandbox, 'scripts', 'run-tests.mjs')], {
      cwd: sandbox, stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(result.signal, null, 'The isolated test runner must finish normally.');
  assert.equal(result.code, 0, 'All tests must pass without personal configuration.');
  assert.equal(await missing(path.join(sandbox, 'secrets.txt')), true);
  assert.equal(await missing(path.join(sandbox, 'src', 'generated')), true,
    'Tests must not generate configuration files, even dummy ones.');
  console.log('Clean-checkout test isolation verified; no configuration files were created.');
} finally {
  // Only remove the unique directory this script created, never a workspace.
  if (path.dirname(sandbox) !== temporaryRoot || !path.basename(sandbox).startsWith('crate-tests-')) {
    throw new Error('Refusing to clean an unexpected test directory.');
  }
  await rm(sandbox, { recursive: true, force: true });
}
