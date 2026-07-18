import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";

const assertResolvedPathInsideRepository = ({
  repositoryRootRealPath,
  resolvedPath,
  allowRepositoryRoot = false,
}) => {
  const relativePath = path.relative(repositoryRootRealPath, resolvedPath);
  if (
    (!allowRepositoryRoot && relativePath === "") ||
    relativePath.startsWith(`..${path.sep}`) ||
    relativePath === ".." ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("Resolved output path is outside the repository root.");
  }
};

export const assertSafeOutputDirectory = async ({
  repositoryRoot,
  outputDirectory,
}) => {
  const rootRealPath = await realpath(repositoryRoot);

  try {
    const outputDirectoryStat = await lstat(outputDirectory);
    if (outputDirectoryStat.isSymbolicLink()) {
      throw new Error("Refusing to build into a symlinked dist directory.");
    }
    if (!outputDirectoryStat.isDirectory()) {
      throw new Error("The dist path exists but is not a directory.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(outputDirectory, { recursive: false });
  }

  const outputDirectoryRealPath = await realpath(outputDirectory);
  assertResolvedPathInsideRepository({
    repositoryRootRealPath: rootRealPath,
    resolvedPath: outputDirectoryRealPath,
  });
};

export const assertTargetIsNotSymlink = async (targetPath) => {
  try {
    const targetStat = await lstat(targetPath);
    if (targetStat.isSymbolicLink()) {
      throw new Error(`Refusing to replace symlink: ${targetPath}`);
    }
    if (!targetStat.isFile()) {
      throw new Error(`Refusing to replace non-file path: ${targetPath}`);
    }
    return targetStat;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return null;
  }
};

export const assertSafeRepositoryFileTarget = async ({
  repositoryRoot,
  targetPath,
  expectedRelativePath,
}) => {
  const repositoryRootRealPath = await realpath(repositoryRoot);
  const expectedPath = path.resolve(repositoryRoot, expectedRelativePath);
  const resolvedTargetPath = path.resolve(targetPath);
  if (resolvedTargetPath !== expectedPath) {
    throw new Error(
      `Refusing unexpected repository output target: ${resolvedTargetPath}`
    );
  }

  const parentRealPath = await realpath(path.dirname(resolvedTargetPath));
  assertResolvedPathInsideRepository({
    repositoryRootRealPath,
    resolvedPath: parentRealPath,
    allowRepositoryRoot: true,
  });
  await assertTargetIsNotSymlink(resolvedTargetPath);
};

export const atomicWriteFile = async (
  targetPath,
  contents,
  { defaultMode = 0o600 } = {}
) => {
  const existingTarget = await assertTargetIsNotSymlink(targetPath);
  const mode = existingTarget?.mode
    ? existingTarget.mode & 0o777
    : defaultMode;

  const temporaryPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temporaryPath, "wx", mode);
  try {
    await handle.writeFile(contents, "utf8");
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temporaryPath, { force: true });
    throw error;
  }
  await handle.close();

  try {
    await rename(temporaryPath, targetPath);
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes(error?.code)) {
      await rm(temporaryPath, { force: true });
      throw error;
    }

    await assertTargetIsNotSymlink(targetPath);
    await rm(targetPath, { force: true });
    await rename(temporaryPath, targetPath);
  }
};
