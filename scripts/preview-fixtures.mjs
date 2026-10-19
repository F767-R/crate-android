// Serve visual fixtures with the same dummy configuration as Node tests.
// Personal configuration is neither loaded nor exposed by this server.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { load } from './test-config-loader.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const configSource = load('crate-test:build-secrets').source;
const server = await createServer({
  root,
  plugins: [{
    name: 'fixture-configuration',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === './generated/secrets.js' && importer?.replaceAll('\\', '/').endsWith('/src/config.js')) {
        return '\0crate-fixture-secrets';
      }
    },
    load(id) { if (id === '\0crate-fixture-secrets') return configSource; },
  }],
  server: {
    host: '127.0.0.1', port: 5174, strictPort: true,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/secrets*.txt', '**/src/generated/**'] },
  },
});
await server.listen();
console.log('Local fixture: http://127.0.0.1:5174/tests/foundation-playback-preview.html');
