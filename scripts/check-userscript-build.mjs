import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  getUserscriptMetadataValue,
  splitUserscriptSource,
} from "./userscript-source.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const sourcePath = path.join(repositoryRoot, "S1Plus.js");
const outputPath = path.join(repositoryRoot, "dist", "S1Plus.user.js");
const metafilePath = path.join(repositoryRoot, "dist", "S1Plus.meta.json");

const [canonicalSource, bundle, metafileSource] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(outputPath, "utf8"),
  readFile(metafilePath, "utf8"),
]);

if (bundle.charCodeAt(0) === 0xfeff || bundle[0] !== "/") {
  throw new Error("Bundle metadata must start at byte zero without a BOM.");
}
if (/\r/.test(bundle)) {
  throw new Error("Bundle must use LF line endings only.");
}

const canonicalParts = splitUserscriptSource(canonicalSource, sourcePath);
const bundleParts = splitUserscriptSource(bundle, outputPath);
if (canonicalParts.metadata !== bundleParts.metadata) {
  throw new Error("Bundle metadata differs from canonical S1Plus.js metadata.");
}
if (
  JSON.stringify(canonicalParts.directives) !==
  JSON.stringify(bundleParts.directives)
) {
  throw new Error("Bundle metadata directives or directive order changed.");
}

const metadataVersion = getUserscriptMetadataValue(bundleParts, "version");
const runtimeVersionMatches = [
  ...bundleParts.body.matchAll(
    /\bconst\s+SCRIPT_VERSION\s*=\s*["']([^"']+)["']/g
  ),
];
if (runtimeVersionMatches.length !== 1) {
  throw new Error(
    `Expected one runtime SCRIPT_VERSION, received ${runtimeVersionMatches.length}.`
  );
}
if (runtimeVersionMatches[0][1] !== metadataVersion) {
  throw new Error(
    `Runtime version ${runtimeVersionMatches[0][1]} differs from @version ${metadataVersion}.`
  );
}

try {
  new vm.Script(bundleParts.body, { filename: outputPath });
} catch (error) {
  throw new Error(
    `Bundle is not valid classic userscript JavaScript: ${error.message}`
  );
}

const metafile = JSON.parse(metafileSource);
const outputEntries = Object.entries(metafile.outputs || {});
if (outputEntries.length !== 1) {
  throw new Error(
    `Metafile must describe one output, received ${outputEntries.length}.`
  );
}
const [metafileOutputPath, outputInfo] = outputEntries[0];
if (!metafileOutputPath.endsWith("dist/S1Plus.user.js")) {
  throw new Error(`Unexpected metafile output: ${metafileOutputPath}.`);
}
if (outputInfo.entryPoint !== "src/main.js") {
  throw new Error(`Unexpected userscript entry point: ${outputInfo.entryPoint}.`);
}
if ((outputInfo.imports || []).length !== 0) {
  throw new Error("Bundle contains runtime imports or external dependencies.");
}

const expectedInputs = ["S1Plus.js", "src/main.js"];
const inputPaths = Object.keys(metafile.inputs || {}).sort();
if (JSON.stringify(inputPaths) !== JSON.stringify(expectedInputs)) {
  throw new Error(
    `Unexpected Phase 0 build inputs: ${inputPaths.join(", ") || "none"}.`
  );
}

const canonicalBodyBytes = Buffer.byteLength(canonicalParts.body);
const legacyBytesInOutput = Number(
  outputInfo.inputs?.["S1Plus.js"]?.bytesInOutput
);
if (
  !Number.isFinite(legacyBytesInOutput) ||
  legacyBytesInOutput < canonicalBodyBytes * 0.75
) {
  throw new Error(
    `Legacy source contributes only ${legacyBytesInOutput || 0} output bytes; expected the current monolith to remain the dominant Phase 0 input.`
  );
}

const bundleBodyBytes = Buffer.byteLength(bundleParts.body);
const minimumBundleBytes = Math.floor(canonicalBodyBytes * 0.85);
const maximumBundleBytes =
  canonicalBodyBytes + Math.max(64 * 1024, Math.ceil(canonicalBodyBytes * 0.35));
const sizeRatio = bundleBodyBytes / Math.max(1, canonicalBodyBytes);
if (
  bundleBodyBytes < minimumBundleBytes ||
  bundleBodyBytes > maximumBundleBytes
) {
  throw new Error(
    `Bundle body size ${bundleBodyBytes} is outside the Phase 0 guard range ${minimumBundleBytes}-${maximumBundleBytes}.`
  );
}
if (/sourceMappingURL=/.test(bundleParts.body)) {
  throw new Error("Release preview bundle must not include a source map reference.");
}

console.log(
  `Verified ${path.relative(repositoryRoot, outputPath)} (${inputPaths.length} inputs, legacy output ${legacyBytesInOutput} bytes, size ratio ${sizeRatio.toFixed(3)}).`
);
