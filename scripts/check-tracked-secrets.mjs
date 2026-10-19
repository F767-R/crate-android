import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawSecrets = await readFile(path.join(projectRoot, 'secrets.txt'), 'utf8');
const secrets = JSON.parse(rawSecrets.replace(/^\uFEFF/, ''));
const sensitiveKeys = [
  'JELLYFIN_SERVER',
  'JELLYFIN_API_KEY',
  'DEEPL_API_KEY',
  'DEEPL_GLOSSARY_ID',
  'DEEPL_ENDPOINT',
];

const secretValues = sensitiveKeys
  .map((key) => typeof secrets[key] === 'string' ? secrets[key].trim() : secrets[key])
  .filter((value) => typeof value === 'string' && value.length >= 8)
  .filter((value) => !/[\r\n]/.test(value));

const trackedFiles = execFileSync('git', ['ls-files'], {
  cwd: projectRoot,
  encoding: 'utf8',
}).split(/\r?\n/).filter(Boolean);

let matches = [];
if (process.argv.includes('--worktree')) {
  const files = [...new Set(execFileSync('git', ['ls-files', '-z', '-c', '-o', '--exclude-standard'], {
    cwd: projectRoot, encoding: 'utf8',
  }).split('\0').filter(Boolean))];
  for (const relativePath of files) {
    let content;
    try { content = await readFile(path.join(projectRoot, relativePath)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (secretValues.some(value => content.includes(Buffer.from(value)))) matches.push(relativePath);
  }
  if (matches.length) {
    console.error('Personal configuration values were detected in publishable working files:');
    matches.forEach(relativePath => console.error(`- ${relativePath}`));
    process.exit(1);
  }
  console.log(`No extracted secret values were found in ${files.length} publishable working files.`);
  process.exit(0);
}
if (!secretValues.length) {
  console.log('No non-placeholder secret values to check.');
  process.exit(0);
}
try {
  const output = execFileSync(
    'git',
    ['grep', '--cached', '-a', '-l', '-F', '-f', '-', '--'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      input: `${secretValues.join('\n')}\n`,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  matches = output.split(/\r?\n/).filter(Boolean);
} catch (error) {
  if (error?.status !== 1) {
    console.error('Could not inspect the staged Git snapshot for secret values.');
    process.exit(1);
  }
}

if (matches.length > 0) {
  console.error('Tracked secret values were detected in:');
  matches.forEach((relativePath) => console.error(`- ${relativePath}`));
  process.exit(1);
}

console.log(`No extracted secret values were found in ${trackedFiles.length} tracked files.`);
