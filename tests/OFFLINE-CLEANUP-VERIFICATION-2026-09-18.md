# Offline controls and album cleanup

Implemented offline-only status/filter controls, filter reset on successful reconnect and new offline sessions, separate online errors, album year beneath the title, plain track numbers, and muted accessible download icons. Disc headings and large artwork remain unchanged.

Validation:

- All 15 JavaScript suites and type checking passed.
- Production build, Capacitor sync, and Android unit-test/build tasks succeeded (native tests unchanged and up to date).
- Real-time headless Edge checks at 390px passed with and without a release year: online row absence, offline availability, failed/successful reconnect, filter reset, accessible icons, cache eviction, and online save errors. Long-title layout visually inspected.
- Virtual-time browser runs timed out during startup; real-time checks resolved this test-harness limitation.
- Packaged JavaScript matches the web build; diff whitespace check passed.
- No ADB device connected; APK not installed on the phone.

APK: `android/app/build/outputs/apk/debug/app-debug.apk`

SHA-256: `82C2446417512F946577DDAFD78FE464FB75E5CD544435EC5F1CED705F94CBBD`
