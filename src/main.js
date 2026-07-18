/**
 * Transitional userscript entry point.
 *
 * The existing root S1Plus.js remains the canonical runtime source during
 * Phase 0. This entry only proves that the complete classic userscript can be
 * bundled into one synchronous installable file. Real production extraction
 * starts only after the Phase 0.5 generated-root cutover.
 */
import "../S1Plus.js";

if (globalThis.__S1P_TEST_MODE__ === true) {
  globalThis.__S1P_BUNDLE_ENTRY_EXECUTIONS__ =
    (globalThis.__S1P_BUNDLE_ENTRY_EXECUTIONS__ || 0) + 1;
}
