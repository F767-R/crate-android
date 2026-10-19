import * as nodeModule from 'node:module';
import { resolve, load } from './test-config-loader.mjs';

// --import loads this before each isolated test process imports application code.
if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({ resolve, load });
} else {
  // Compatibility with Node 20.6+; current Node versions use synchronous hooks.
  nodeModule.register(new URL('./test-config-loader.mjs', import.meta.url), import.meta.url);
}
