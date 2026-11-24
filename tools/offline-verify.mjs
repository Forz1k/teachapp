/* Portable offline verification: the existing Chromium smoke uses a temporary
   isolated profile, stops its own HTTP server and asserts offline reload and
   persistent IndexedDB. Reuse it rather than maintain a second Windows-only
   script with a hardcoded profile directory. The old --clean flag is harmless.
   npm run offline and npm run test:browser intentionally exercise the same suite. */
import './browser-smoke.mjs';
