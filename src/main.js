/**
 * Phase 0.5 production composition entry.
 *
 * The complete legacy userscript body remains intact in src/legacy/main.js.
 * This stage changes source ownership and the release build path only; it does
 * not extract or reorganize business functions.
 */
import "./legacy/main.js";

if (globalThis.__S1P_TEST_MODE__ === true) {
  globalThis.__S1P_BUNDLE_ENTRY_EXECUTIONS__ =
    (globalThis.__S1P_BUNDLE_ENTRY_EXECUTIONS__ || 0) + 1;
}
