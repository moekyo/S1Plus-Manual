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
  const relativeOutputPath = path.relative(rootRealPath, outputDirectoryRealPath);
  if (
    relativeOutputPath === "" ||
    relativeOutputPath.startsWith(`..${path.sep}`) ||
    relativeOutputPath === ".." ||
    path.isAbsolute(relativeOutputPath)
  ) {
    throw new Error("Resolved dist directory is outside the repository root.");
  }
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
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
};

export const atomicWriteFile = async (targetPath, contents) => {
  await assertTargetIsNotSymlink(targetPath);

  const temporaryPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temporaryPath, "wx", 0o600);
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
