# Test and type-check tooling

`npm test` runs each discovered suite in a separate Node process. It discovers
`test*.mjs`, `*-smoke.mjs`, and `*.test.mjs` under this directory, skipping
`fixtures`, `helpers`, and `types` directories. New suites need no package-script
edit. Put non-executable test data and helpers in the skipped directories.

The runner registers an ESM hook before application imports. The exact
`src/generated/secrets.js` import becomes an in-memory, frozen dummy module with
reserved `.invalid` hostnames. The hook does not read `secrets.txt`, open a real
generated module, or write a replacement. Development and production builds
continue to use the existing private-configuration workflow.

Use `npm run test:clean` to verify the same suites in a temporary source checkout
without either configuration file. It reuses installed dependencies, confirms
the tests create no generated config, and removes only its own temporary copy.

Use `npm run typecheck` for the incremental strict checked-JavaScript boundary:

- Shared data and native protocol contracts in `src/types/contracts.d.ts`.
- Pure native snapshot validation and metadata reconstruction.
- Playback-command revision helpers.
- Positive and intentionally invalid JavaScript contract fixtures in `types/`.

Application modules can reference contracts with JSDoc, for example
`@param {import('../types/contracts.js').Track} track`. Add modules to
`tsconfig.json` as their boundaries become annotated; no wholesale conversion
to TypeScript is required.

The GitHub source-check job runs tests and type checks on clean hosted runners.
It has no private build configuration and does not build or upload personal APKs.
