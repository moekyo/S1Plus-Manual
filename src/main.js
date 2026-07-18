/**
 * Transitional userscript entry point.
 *
 * The existing root S1Plus.js remains the canonical runtime source during the
 * foundation phase. New source modules will move under src/ incrementally;
 * the build pipeline bundles this entry into one Tampermonkey-compatible file.
 */
import "../S1Plus.js";
