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
  assertSafeRepositoryFileTarget,
  atomicWriteFile,
} from "../../scripts/userscript-output.mjs";

const hashFile = async (filePath) =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const createFixture = async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "s1p-build-safe-"));
  const legacyDirectory = path.join(repositoryRoot, "src", "legacy");
  const sourcePath = path.join(legacyDirectory, "main.js");
  const outputDirectory = path.join(repositoryRoot, "dist");
  await mkdir(legacyDirectory, { recursive: true });
  await writeFile(sourcePath, "canonical legacy source\n", "utf8");

  return {
    repositoryRoot,
    sourcePath,
    outputDirectory,
    outputPath: path.join(outputDirectory, "S1Plus.user.js"),
    metafilePath: path.join(outputDirectory, "S1Plus.meta.json"),
    releasePath: path.join(repositoryRoot, "S1Plus.js"),
    sourceHash: await hashFile(sourcePath),
  };
};

const assertCanonicalUnchanged = async ({ sourcePath, sourceHash }) => {
  assert.equal(
    await hashFile(sourcePath),
    sourceHash,
    "Rejected output paths must not modify src/legacy/main.js."
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
  await assertSafeRepositoryFileTarget({
    repositoryRoot: fixture.repositoryRoot,
    targetPath: fixture.releasePath,
    expectedRelativePath: "S1Plus.js",
  });
  await atomicWriteFile(fixture.releasePath, "release\n", { defaultMode: 0o644 });
  assert.equal(await readFile(fixture.outputPath, "utf8"), "preview\n");
  assert.equal(await readFile(fixture.metafilePath, "utf8"), "{}\n");
  assert.equal(await readFile(fixture.releasePath, "utf8"), "release\n");
  await assertCanonicalUnchanged(fixture);
});

for (const targetName of ["outputPath", "metafilePath"]) {
  await withFixture(async (fixture) => {
    await assertSafeOutputDirectory(fixture);
    const created = await createTestSymlink(
      path.relative(fixture.outputDirectory, fixture.sourcePath),
      fixture[targetName],
      "file"
    );
    if (!created) return;

    await assert.rejects(
      atomicWriteFile(fixture[targetName], "replacement\n"),
      /Refusing to replace symlink/
    );
    await assertCanonicalUnchanged(fixture);
  });
}

await withFixture(async (fixture) => {
  const created = await createTestSymlink(
    path.relative(fixture.repositoryRoot, fixture.sourcePath),
    fixture.releasePath,
    "file"
  );
  if (!created) return;

  await assert.rejects(
    assertSafeRepositoryFileTarget({
      repositoryRoot: fixture.repositoryRoot,
      targetPath: fixture.releasePath,
      expectedRelativePath: "S1Plus.js",
    }),
    /Refusing to replace symlink/
  );
  await assertCanonicalUnchanged(fixture);
});

await withFixture(async (fixture) => {
  await assert.rejects(
    assertSafeRepositoryFileTarget({
      repositoryRoot: fixture.repositoryRoot,
      targetPath: path.join(fixture.repositoryRoot, "unexpected.js"),
      expectedRelativePath: "S1Plus.js",
    }),
    /unexpected repository output target/
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
  `[userscript-build-safety] Preview/release writes and output-boundary rejection verified${
    skippedSymlinkScenarios
      ? ` (${skippedSymlinkScenarios} symlink scenario(s) skipped by the host OS)`
      : ""
  }.`
);
