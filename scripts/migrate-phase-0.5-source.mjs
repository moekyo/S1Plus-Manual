import { lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  renderUserscriptMetadata,
  USERSCRIPT_VERSION,
} from "../userscript.config.mjs";
import {
  buildUserscript,
  repositoryRoot,
  userscriptPaths,
} from "./userscript-build.mjs";
import { atomicWriteFile } from "./userscript-output.mjs";
import {
  getUserscriptMetadataValue,
  splitUserscriptSource,
  USERSCRIPT_METADATA_END,
  USERSCRIPT_METADATA_START,
} from "./userscript-source.mjs";

const legacyDirectory = path.dirname(userscriptPaths.legacySource);

const assertLegacyBody = (source, filePath) => {
  if (
    source.includes(USERSCRIPT_METADATA_START) ||
    source.includes(USERSCRIPT_METADATA_END)
  ) {
    throw new Error(`${filePath} unexpectedly contains userscript metadata.`);
  }
  if (/\r/.test(source) || source.charCodeAt(0) === 0xfeff) {
    throw new Error(`${filePath} must be UTF-8 without BOM and use LF only.`);
  }
  const versionTokens = source.match(/\b__S1P_USERSCRIPT_VERSION__\b/g) || [];
  if (versionTokens.length !== 1) {
    throw new Error(
      `${filePath} must contain exactly one __S1P_USERSCRIPT_VERSION__ token; received ${versionTokens.length}.`
    );
  }
};

const buildBothTargets = async () => {
  const preview = await buildUserscript({ target: "preview" });
  const release = await buildUserscript({ target: "release" });
  if (preview.output !== release.output) {
    throw new Error("Preview and release builds differ after source migration.");
  }
};

let existingLegacySource = null;
try {
  const legacyStat = await lstat(userscriptPaths.legacySource);
  if (legacyStat.isSymbolicLink() || !legacyStat.isFile()) {
    throw new Error("src/legacy/main.js must be a regular file.");
  }
  existingLegacySource = await readFile(userscriptPaths.legacySource, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

if (existingLegacySource !== null) {
  assertLegacyBody(existingLegacySource, userscriptPaths.legacySource);
  await buildBothTargets();
  console.log(
    "Phase 0.5 source ownership was already migrated; preview and release artifacts were rebuilt."
  );
  process.exit(0);
}

const rootSource = await readFile(userscriptPaths.release, "utf8");
const rootParts = splitUserscriptSource(rootSource, userscriptPaths.release);
const configuredMetadata = renderUserscriptMetadata();
if (rootParts.metadata !== configuredMetadata) {
  throw new Error(
    "Current S1Plus.js metadata differs from userscript.config.mjs; refusing source cutover."
  );
}
const rootMetadataVersion = getUserscriptMetadataValue(rootParts, "version");
if (rootMetadataVersion !== USERSCRIPT_VERSION) {
  throw new Error(
    `Current root @version ${rootMetadataVersion} differs from configured ${USERSCRIPT_VERSION}.`
  );
}

const runtimeVersionPattern =
  /^([\t ]*)const[\t ]+SCRIPT_VERSION[\t ]*=[\t ]*["']([^"']+)["'];[\t ]*$/gm;
const runtimeVersionMatches = [...rootParts.body.matchAll(runtimeVersionPattern)];
if (runtimeVersionMatches.length !== 1) {
  throw new Error(
    `Expected one literal SCRIPT_VERSION assignment in current S1Plus.js; received ${runtimeVersionMatches.length}.`
  );
}
if (runtimeVersionMatches[0][2] !== USERSCRIPT_VERSION) {
  throw new Error(
    `Current runtime version ${runtimeVersionMatches[0][2]} differs from configured ${USERSCRIPT_VERSION}.`
  );
}

const migratedBody = rootParts.body.replace(
  runtimeVersionPattern,
  (_match, indentation) =>
    `${indentation}const SCRIPT_VERSION = __S1P_USERSCRIPT_VERSION__;`
);
assertLegacyBody(migratedBody, userscriptPaths.legacySource);

try {
  const directoryStat = await lstat(legacyDirectory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error("src/legacy must be a regular directory.");
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  await mkdir(legacyDirectory, { recursive: false });
}

await atomicWriteFile(userscriptPaths.legacySource, migratedBody, {
  defaultMode: 0o644,
});
await buildBothTargets();

console.log(
  `Moved the intact legacy body to ${path.relative(repositoryRoot, userscriptPaths.legacySource)} and generated matching preview/release artifacts.`
);
