import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import {
  renderUserscriptMetadata,
  USERSCRIPT_VERSION,
} from "../userscript.config.mjs";
import { repositoryRoot, userscriptPaths } from "./userscript-build.mjs";
import {
  getUserscriptMetadataValue,
  splitUserscriptSource,
  USERSCRIPT_METADATA_END,
  USERSCRIPT_METADATA_START,
} from "./userscript-source.mjs";

const [releaseBuffer, previewBuffer, metafileSource, legacySource] =
  await Promise.all([
    readFile(userscriptPaths.release),
    readFile(userscriptPaths.preview),
    readFile(userscriptPaths.previewMetafile, "utf8"),
    readFile(userscriptPaths.legacySource, "utf8"),
  ]);

if (!releaseBuffer.equals(previewBuffer)) {
  throw new Error(
    "Committed S1Plus.js differs from dist/S1Plus.user.js built from the same source/config."
  );
}

const releaseSource = releaseBuffer.toString("utf8");
const previewSource = previewBuffer.toString("utf8");
for (const [label, source] of [
  ["release", releaseSource],
  ["preview", previewSource],
]) {
  if (source.charCodeAt(0) === 0xfeff || source[0] !== "/") {
    throw new Error(`${label} metadata must start at byte zero without a BOM.`);
  }
  if (/\r/.test(source)) {
    throw new Error(`${label} userscript must use LF line endings only.`);
  }
}

const configuredMetadata = renderUserscriptMetadata();
const releaseParts = splitUserscriptSource(releaseSource, userscriptPaths.release);
const previewParts = splitUserscriptSource(previewSource, userscriptPaths.preview);
for (const [label, parts] of [
  ["release", releaseParts],
  ["preview", previewParts],
]) {
  if (parts.metadata !== configuredMetadata) {
    throw new Error(`${label} metadata differs from userscript.config.mjs.`);
  }
  const metadataVersion = getUserscriptMetadataValue(parts, "version");
  if (metadataVersion !== USERSCRIPT_VERSION) {
    throw new Error(
      `${label} @version ${metadataVersion} differs from configured ${USERSCRIPT_VERSION}.`
    );
  }

  const runtimeVersionMatches = [
    ...parts.body.matchAll(
      /\bconst\s+SCRIPT_VERSION\s*=\s*["']([^"']+)["']/g
    ),
  ];
  if (runtimeVersionMatches.length !== 1) {
    throw new Error(
      `${label} must contain one runtime SCRIPT_VERSION; received ${runtimeVersionMatches.length}.`
    );
  }
  if (runtimeVersionMatches[0][1] !== USERSCRIPT_VERSION) {
    throw new Error(
      `${label} runtime version ${runtimeVersionMatches[0][1]} differs from configured ${USERSCRIPT_VERSION}.`
    );
  }

  try {
    new vm.Script(parts.body, { filename: label });
  } catch (error) {
    throw new Error(
      `${label} output is not valid classic userscript JavaScript: ${error.message}`
    );
  }
  if (/sourceMappingURL=/.test(parts.body)) {
    throw new Error(`${label} userscript must not include a source map reference.`);
  }
}

if (
  legacySource.includes(USERSCRIPT_METADATA_START) ||
  legacySource.includes(USERSCRIPT_METADATA_END)
) {
  throw new Error(
    "src/legacy/main.js contains metadata even though userscript.config.mjs is canonical."
  );
}
if (/\r/.test(legacySource) || legacySource.charCodeAt(0) === 0xfeff) {
  throw new Error("src/legacy/main.js must be UTF-8 without BOM and use LF only.");
}
const sourceVersionTokens =
  legacySource.match(/\b__S1P_USERSCRIPT_VERSION__\b/g) || [];
if (sourceVersionTokens.length !== 1) {
  throw new Error(
    `src/legacy/main.js must contain one configured version token; received ${sourceVersionTokens.length}.`
  );
}
if (/\bconst\s+SCRIPT_VERSION\s*=\s*["']/.test(legacySource)) {
  throw new Error(
    "src/legacy/main.js must not own a literal runtime version value."
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

const expectedInputs = ["src/legacy/main.js", "src/main.js"];
const inputPaths = Object.keys(metafile.inputs || {}).sort();
if (JSON.stringify(inputPaths) !== JSON.stringify(expectedInputs)) {
  throw new Error(
    `Unexpected Phase 0.5 build inputs: ${inputPaths.join(", ") || "none"}.`
  );
}

const legacySourceBytes = Buffer.byteLength(legacySource);
const legacyBytesInOutput = Number(
  outputInfo.inputs?.["src/legacy/main.js"]?.bytesInOutput
);
if (
  !Number.isFinite(legacyBytesInOutput) ||
  legacyBytesInOutput < legacySourceBytes * 0.75
) {
  throw new Error(
    `Legacy source contributes only ${legacyBytesInOutput || 0} output bytes; expected the intact legacy body to remain the dominant Phase 0.5 input.`
  );
}

const bundleBodyBytes = Buffer.byteLength(previewParts.body);
const minimumBundleBytes = Math.floor(legacySourceBytes * 0.85);
const maximumBundleBytes =
  legacySourceBytes + Math.max(64 * 1024, Math.ceil(legacySourceBytes * 0.35));
const sizeRatio = bundleBodyBytes / Math.max(1, legacySourceBytes);
if (
  bundleBodyBytes < minimumBundleBytes ||
  bundleBodyBytes > maximumBundleBytes
) {
  throw new Error(
    `Bundle body size ${bundleBodyBytes} is outside the Phase 0.5 guard range ${minimumBundleBytes}-${maximumBundleBytes}.`
  );
}

console.log(
  `Verified generated root/preview parity (${inputPaths.length} inputs, legacy output ${legacyBytesInOutput} bytes, size ratio ${sizeRatio.toFixed(3)}, version ${USERSCRIPT_VERSION}).`
);
