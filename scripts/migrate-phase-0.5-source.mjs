import { lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  renderUserscriptMetadata,
  USERSCRIPT_VERSION,
} from "../userscript.config.mjs";
import {
  GENERATED_USERSCRIPT_BANNER,
  renderUserscript,
  repositoryRoot,
  userscriptPaths,
  writeUserscriptBuildResult,
} from "./userscript-build.mjs";
import { atomicWriteFile } from "./userscript-output.mjs";
import {
  assertPhase05CandidateMatchesPlan,
  planPhase05SourceMigration,
} from "./phase-0.5-source-migration-core.mjs";

const readOptionalRegularFile = async ({ filePath, lstatImpl, readFileImpl }) => {
  try {
    const fileStat = await lstatImpl(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      throw new Error(`${filePath} must be a regular file.`);
    }
    return await readFileImpl(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
};

const ensureRegularDirectory = async ({ directoryPath, lstatImpl, mkdirImpl }) => {
  try {
    const directoryStat = await lstatImpl(directoryPath);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      throw new Error(`${directoryPath} must be a regular directory.`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdirImpl(directoryPath, { recursive: false });
  }
};

export const runPhase05SourceMigration = async ({
  repositoryRootPath = repositoryRoot,
  paths = userscriptPaths,
  lstatImpl = lstat,
  mkdirImpl = mkdir,
  readFileImpl = readFile,
  atomicWriteFileImpl = atomicWriteFile,
  renderUserscriptImpl = renderUserscript,
  writeUserscriptBuildResultImpl = writeUserscriptBuildResult,
  configuredMetadata = renderUserscriptMetadata(),
  userscriptVersion = USERSCRIPT_VERSION,
  generatedBanner = GENERATED_USERSCRIPT_BANNER,
} = {}) => {
  const rootSource = await readFileImpl(paths.release, "utf8");
  const existingLegacySource = await readOptionalRegularFile({
    filePath: paths.legacySource,
    lstatImpl,
    readFileImpl,
  });

  const plan = planPhase05SourceMigration({
    rootSource,
    rootPath: paths.release,
    existingLegacySource,
    legacyPath: paths.legacySource,
    configuredMetadata,
    userscriptVersion,
    generatedBanner,
  });

  if (plan.state === "initial") {
    await ensureRegularDirectory({
      directoryPath: path.dirname(paths.legacySource),
      lstatImpl,
      mkdirImpl,
    });
    await atomicWriteFileImpl(paths.legacySource, plan.expectedLegacySource, {
      defaultMode: 0o644,
    });
  }

  const buildResult = await renderUserscriptImpl();
  assertPhase05CandidateMatchesPlan({
    plan,
    candidateOutput: buildResult.output,
  });

  const preview = await writeUserscriptBuildResultImpl({
    target: "preview",
    buildResult,
  });
  const release = await writeUserscriptBuildResultImpl({
    target: "release",
    buildResult,
  });
  if (preview.output !== release.output) {
    throw new Error("Preview and release writes diverged after source migration.");
  }

  const relativeLegacyPath = path.relative(
    repositoryRootPath,
    paths.legacySource
  );
  const stateMessages = {
    initial: `Moved the intact legacy body to ${relativeLegacyPath}`,
    resume: `Validated existing ${relativeLegacyPath} against the current Phase 0 root`,
    generated: `Validated generated root against ${relativeLegacyPath}`,
  };
  console.log(
    `${stateMessages[plan.state]} and wrote matching preview/release artifacts from one in-memory candidate.`
  );

  return Object.freeze({
    state: plan.state,
    buildResult,
  });
};

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  await runPhase05SourceMigration();
}
