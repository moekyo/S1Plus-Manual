import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertSafeOutputDirectory,
  atomicWriteFile,
} from "../../scripts/userscript-output.mjs";

const hashFile = async (filePath) =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const createFixture = async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "s1p-build-safe-"));
  const sourcePath = path.join(repositoryRoot, "S1Plus.js");
  const outputDirectory = path.join(repositoryRoot, "dist");
  await writeFile(sourcePath, "canonical userscript source\n", "utf8");

  return {
    repositoryRoot,
    sourcePath,
    outputDirectory,
    outputPath: path.join(outputDirectory, "S1Plus.user.js"),
    metafilePath: path.join(outputDirectory, "S1Plus.meta.json"),
    sourceHash: await hashFile(sourcePath),
  };
};

const assertCanonicalUnchanged = async ({ sourcePath, sourceHash }) => {
  assert.equal(
    await hashFile(sourcePath),
    sourceHash,
    "Rejected output paths must not modify the canonical userscript source."
  );
};

let skippedSymlinkScenarios = 0;
const createTestSymlink = async (target, linkPath, type) => {
  try {
    await symlink(target, linkPath, type);
    return true;
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
      skippedSymlinkScenarios += 1;
      console.warn(
        `[userscript-build-safety] Skipping symlink scenario (${error.code}): ${linkPath}`
      );
      return false;
    }
    throw error;
  }
};

const withFixture = async (test) => {
  const fixture = await createFixture();
  try {
    await test(fixture);
  } finally {
    await rm(fixture.repositoryRoot, { recursive: true, force: true });
  }
};

await withFixture(async (fixture) => {
  await assertSafeOutputDirectory(fixture);
  await atomicWriteFile(fixture.outputPath, "preview\n");
  await atomicWriteFile(fixture.metafilePath, "{}\n");
  assert.equal(await readFile(fixture.outputPath, "utf8"), "preview\n");
  assert.equal(await readFile(fixture.metafilePath, "utf8"), "{}\n");
  await assertCanonicalUnchanged(fixture);
});

await withFixture(async (fixture) => {
  await assertSafeOutputDirectory(fixture);
  const created = await createTestSymlink(
    path.relative(fixture.outputDirectory, fixture.sourcePath),
    fixture.outputPath,
    "file"
  );
  if (!created) return;

  await assert.rejects(
    atomicWriteFile(fixture.outputPath, "replacement\n"),
    /Refusing to replace symlink/
  );
  await assertCanonicalUnchanged(fixture);
});

await withFixture(async (fixture) => {
  await assertSafeOutputDirectory(fixture);
  const created = await createTestSymlink(
    path.relative(fixture.outputDirectory, fixture.sourcePath),
    fixture.metafilePath,
    "file"
  );
  if (!created) return;

  await assert.rejects(
    atomicWriteFile(fixture.metafilePath, "replacement\n"),
    /Refusing to replace symlink/
  );
  await assertCanonicalUnchanged(fixture);
});

await withFixture(async (fixture) => {
  const externalDirectory = await mkdtemp(
    path.join(os.tmpdir(), "s1p-build-external-")
  );
  try {
    const created = await createTestSymlink(
      externalDirectory,
      fixture.outputDirectory,
      "dir"
    );
    if (!created) return;

    await assert.rejects(
      assertSafeOutputDirectory(fixture),
      /symlinked dist directory/
    );
    await assertCanonicalUnchanged(fixture);
  } finally {
    await rm(externalDirectory, { recursive: true, force: true });
  }
});

await withFixture(async (fixture) => {
  await writeFile(fixture.outputDirectory, "not a directory\n", "utf8");
  await assert.rejects(
    assertSafeOutputDirectory(fixture),
    /dist path exists but is not a directory/
  );
  await assertCanonicalUnchanged(fixture);
});

console.log(
  `[userscript-build-safety] Safe writes and output-boundary rejection verified${
    skippedSymlinkScenarios
      ? ` (${skippedSymlinkScenarios} symlink scenario(s) skipped by the host OS)`
      : ""
  }.`
);
