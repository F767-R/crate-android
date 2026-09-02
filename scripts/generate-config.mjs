import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secretsPath = path.join(projectRoot, 'secrets.txt');
const generatedDirectory = path.join(projectRoot, 'src', 'generated');
const generatedPath = path.join(generatedDirectory, 'secrets.js');

const allowedKeys = new Set([
  'JELLYFIN_SERVER',
  'JELLYFIN_API_KEY',
  'DEEPL_API_URL',
  'DEEPL_API_KEY',
  'DEEPL_TARGET_LANG',
  'DEEPL_SOURCE_LANG',
  'DEEPL_GLOSSARY_ID',
]);

const requiredKeys = [
  'JELLYFIN_SERVER',
  'JELLYFIN_API_KEY',
  'DEEPL_API_URL',
  'DEEPL_TARGET_LANG',
];

function fail(message) {
  console.error(`Configuration error: ${message}`);
  console.error('Copy secrets.example.txt to secrets.txt, fill in your own values, and try again.');
  process.exit(1);
}

let rawSecrets;
try {
  rawSecrets = await readFile(secretsPath, 'utf8');
} catch (error) {
  if (error?.code === 'ENOENT') {
    fail('secrets.txt is required for local development and builds.');
  }
  fail(`could not read secrets.txt (${error?.code || 'unknown error'}).`);
}

let secrets;
try {
  secrets = JSON.parse(rawSecrets.replace(/^\uFEFF/, ''));
} catch {
  fail('secrets.txt must contain valid JSON.');
}

if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) {
  fail('secrets.txt must contain one JSON object.');
}

const unknownKeys = Object.keys(secrets).filter((key) => !allowedKeys.has(key));
if (unknownKeys.length > 0) {
  fail(`secrets.txt contains unknown keys: ${unknownKeys.join(', ')}.`);
}

const missingKeys = [...allowedKeys].filter((key) => !(key in secrets));
if (missingKeys.length > 0) {
  fail(`secrets.txt is missing keys: ${missingKeys.join(', ')}.`);
}

for (const [key, value] of Object.entries(secrets)) {
  if (typeof value !== 'string') {
    fail(`${key} must be a string.`);
  }
  secrets[key] = value.trim();
  if (/[\r\n]/.test(secrets[key])) {
    fail(`${key} must fit on one line.`);
  }
}

const emptyRequiredKeys = requiredKeys.filter((key) => !secrets[key]);
if (emptyRequiredKeys.length > 0) {
  fail(`required values are empty: ${emptyRequiredKeys.join(', ')}.`);
}

if (Object.values(secrets).some((value) => value.includes('replace-with-'))) {
  fail('replace every placeholder value before building.');
}

let jellyfinServer;
try {
  jellyfinServer = new URL(secrets.JELLYFIN_SERVER);
} catch {
  fail('JELLYFIN_SERVER must be an absolute URL.');
}

if (!['http:', 'https:'].includes(jellyfinServer.protocol)) {
  fail('JELLYFIN_SERVER must use HTTP or HTTPS.');
}

try {
  const translationUrl = new URL(secrets.DEEPL_API_URL, jellyfinServer);
  if (!['http:', 'https:'].includes(translationUrl.protocol)) {
    throw new Error('unsupported protocol');
  }
} catch {
  fail('DEEPL_API_URL must be an HTTP(S) URL or a path relative to JELLYFIN_SERVER.');
}

const normalizedSecrets = {
  ...secrets,
  JELLYFIN_SERVER: secrets.JELLYFIN_SERVER.replace(/\/+$/, ''),
  DEEPL_TARGET_LANG: secrets.DEEPL_TARGET_LANG.toUpperCase(),
  DEEPL_SOURCE_LANG: secrets.DEEPL_SOURCE_LANG.toUpperCase(),
};

const serializedSecrets = JSON.stringify(normalizedSecrets, null, 2)
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

const generatedSource = [
  '// Generated from the ignored secrets.txt file. Do not edit or commit this file.',
  `export const buildSecrets = Object.freeze(${serializedSecrets});`,
  '',
].join('\n');

await mkdir(generatedDirectory, { recursive: true });
await writeFile(generatedPath, generatedSource, 'utf8');
console.log('Generated local build configuration from secrets.txt.');
