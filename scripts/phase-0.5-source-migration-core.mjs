import {
  getUserscriptMetadataValue,
  splitUserscriptSource,
  USERSCRIPT_METADATA_END,
  USERSCRIPT_METADATA_START,
} from "./userscript-source.mjs";

const runtimeVersionPattern =
  /^([\t ]*)const[\t ]+SCRIPT_VERSION[\t ]*=[\t ]*["']([^"']+)["'];[\t ]*$/gm;

export const assertPhase05LegacyBody = (source, filePath) => {
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

const inspectRoot = ({
  rootSource,
  rootPath,
  configuredMetadata,
  userscriptVersion,
  generatedBanner,
}) => {
  const rootParts = splitUserscriptSource(rootSource, rootPath);
  if (rootParts.metadata !== configuredMetadata) {
    throw new Error(
      "Current S1Plus.js metadata differs from userscript.config.mjs; refusing source cutover."
    );
  }

  const rootMetadataVersion = getUserscriptMetadataValue(rootParts, "version");
  if (rootMetadataVersion !== userscriptVersion) {
    throw new Error(
      `Current root @version ${rootMetadataVersion} differs from configured ${userscriptVersion}.`
    );
  }

  return Object.freeze({
    rootParts,
    isGenerated: rootParts.body.startsWith(`${generatedBanner}\n`),
  });
};

export const deriveExpectedPhase05LegacyBody = ({
  rootSource,
  rootPath,
  configuredMetadata,
  userscriptVersion,
  generatedBanner,
  legacyPath,
}) => {
  const { rootParts, isGenerated } = inspectRoot({
    rootSource,
    rootPath,
    configuredMetadata,
    userscriptVersion,
    generatedBanner,
  });
  if (isGenerated) {
    throw new Error(
      "Cannot derive legacy source from an already generated S1Plus.js artifact."
    );
  }

  const runtimeVersionMatches = [...rootParts.body.matchAll(runtimeVersionPattern)];
  if (runtimeVersionMatches.length !== 1) {
    throw new Error(
      `Expected one literal SCRIPT_VERSION assignment in current S1Plus.js; received ${runtimeVersionMatches.length}.`
    );
  }
  if (runtimeVersionMatches[0][2] !== userscriptVersion) {
    throw new Error(
      `Current runtime version ${runtimeVersionMatches[0][2]} differs from configured ${userscriptVersion}.`
    );
  }

  const expectedLegacySource = rootParts.body.replace(
    runtimeVersionPattern,
    (_match, indentation) =>
      `${indentation}const SCRIPT_VERSION = __S1P_USERSCRIPT_VERSION__;`
  );
  assertPhase05LegacyBody(expectedLegacySource, legacyPath);
  return expectedLegacySource;
};

export const planPhase05SourceMigration = ({
  rootSource,
  rootPath,
  existingLegacySource,
  legacyPath,
  configuredMetadata,
  userscriptVersion,
  generatedBanner,
}) => {
  const rootInspection = inspectRoot({
    rootSource,
    rootPath,
    configuredMetadata,
    userscriptVersion,
    generatedBanner,
  });

  if (existingLegacySource === null) {
    if (rootInspection.isGenerated) {
      throw new Error(
        "S1Plus.js is already generated but src/legacy/main.js is missing; refusing to reconstruct source from an artifact."
      );
    }
    return Object.freeze({
      state: "initial",
      rootSource,
      expectedLegacySource: deriveExpectedPhase05LegacyBody({
        rootSource,
        rootPath,
        configuredMetadata,
        userscriptVersion,
        generatedBanner,
        legacyPath,
      }),
    });
  }

  assertPhase05LegacyBody(existingLegacySource, legacyPath);

  if (rootInspection.isGenerated) {
    return Object.freeze({
      state: "generated",
      rootSource,
      expectedLegacySource: existingLegacySource,
    });
  }

  const expectedLegacySource = deriveExpectedPhase05LegacyBody({
    rootSource,
    rootPath,
    configuredMetadata,
    userscriptVersion,
    generatedBanner,
    legacyPath,
  });
  if (existingLegacySource !== expectedLegacySource) {
    throw new Error(
      "Existing src/legacy/main.js conflicts with the exact body derived from current S1Plus.js; refusing to overwrite any artifact."
    );
  }

  return Object.freeze({
    state: "resume",
    rootSource,
    expectedLegacySource,
  });
};

export const assertPhase05CandidateMatchesPlan = ({ plan, candidateOutput }) => {
  if (typeof candidateOutput !== "string" || candidateOutput.length === 0) {
    throw new Error("Rendered userscript candidate is empty or invalid.");
  }
  if (plan.state === "generated" && candidateOutput !== plan.rootSource) {
    throw new Error(
      "Existing generated S1Plus.js conflicts with the in-memory candidate rendered from src/legacy/main.js and userscript.config.mjs; refusing to overwrite root or preview."
    );
  }
};
