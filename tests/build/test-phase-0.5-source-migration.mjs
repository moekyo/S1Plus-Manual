import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  renderUserscriptMetadata,
  USERSCRIPT_VERSION,
} from "../../userscript.config.mjs";
import {
  GENERATED_USERSCRIPT_BANNER,
} from "../../scripts/userscript-build.mjs";
import { runPhase05SourceMigration } from "../../scripts/migrate-phase-0.5-source.mjs";

const metadata = renderUserscriptMetadata();
const phase0Body = `(function () {\n  "use strict";\n  const SCRIPT_VERSION = "${USERSCRIPT_VERSION}";\n  console.log("correct source");\n})();\n`;
const expectedLegacySource = phase0Body.replace(
  `"${USERSCRIPT_VERSION}"`,
  "__S1P_USERSCRIPT_VERSION__"
);
const phase0Root = `${metadata}\n${phase0Body}`;

const renderCandidate = (legacySource) =>
  `${metadata}\n${GENERATED_USERSCRIPT_BANNER}\n${legacySource.replace(
    /\b__S1P_USERSCRIPT_VERSION__\b/g,
    JSON.stringify(USERSCRIPT_VERSION)
  )}`;

const hashFile = async (filePath) =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const createFixture = async ({
  rootSource = phase0Root,
  legacySource = null,
  previewSource = "preview-before\n",
} = {}) => {
  const repositoryRoot = await mkdtemp(
    path.join(os.tmpdir(), "s1p-phase-0.5-migration-")
  );
  const paths = {
    release: path.join(repositoryRoot, "S1Plus.js"),
    legacySource: path.join(repositoryRoot, "src", "legacy", "main.js"),
    preview: path.join(repositoryRoot, "dist", "S1Plus.user.js"),
    previewMetafile: path.join(repositoryRoot, "dist", "S1Plus.meta.json"),
  };

  await mkdir(path.join(repositoryRoot, "src"), { recursive: true });
  await mkdir(path.dirname(paths.preview), { recursive: true });
  await writeFile(paths.release, rootSource, "utf8");
  await writeFile(paths.preview, previewSource, "utf8");
  await writeFile(paths.previewMetafile, "{}\n", "utf8");
  if (legacySource !== null) {
    await mkdir(path.dirname(paths.legacySource), { recursive: true });
    await writeFile(paths.legacySource, legacySource, "utf8");
  }

  return { repositoryRoot, paths };
};

const withFixture = async (options, test) => {
  const fixture = await createFixture(options);
  try {
    await test(fixture);
  } finally {
    await rm(fixture.repositoryRoot, { recursive: true, force: true });
  }
};

const runFixtureMigration = async (fixture, counters = {}) => {
  counters.renderCalls = counters.renderCalls || 0;
  counters.writeCalls = counters.writeCalls || [];

  return runPhase05SourceMigration({
    repositoryRootPath: fixture.repositoryRoot,
    paths: fixture.paths,
    atomicWriteFileImpl: async (targetPath, contents) => {
      await writeFile(targetPath, contents, "utf8");
    },
    renderUserscriptImpl: async () => {
      counters.renderCalls += 1;
      const legacySource = await readFile(fixture.paths.legacySource, "utf8");
      return {
        output: renderCandidate(legacySource),
        metafile: { inputs: {}, outputs: {} },
      };
    },
    writeUserscriptBuildResultImpl: async ({ target, buildResult }) => {
      counters.writeCalls.push(target);
      if (target === "preview") {
        await writeFile(fixture.paths.preview, buildResult.output, "utf8");
        await writeFile(
          fixture.paths.previewMetafile,
          `${JSON.stringify(buildResult.metafile)}\n`,
          "utf8"
        );
      } else if (target === "release") {
        await writeFile(fixture.paths.release, buildResult.output, "utf8");
      } else {
        throw new Error(`Unexpected fixture target: ${target}`);
      }
      return { target, output: buildResult.output };
    },
  });
};

const assertRejectedWithoutArtifactWrites = async ({
  fixture,
  expectedError,
  counters,
}) => {
  const rootHashBefore = await hashFile(fixture.paths.release);
  const previewHashBefore = await hashFile(fixture.paths.preview);

  await assert.rejects(runFixtureMigration(fixture, counters), expectedError);

  assert.equal(await hashFile(fixture.paths.release), rootHashBefore);
  assert.equal(await hashFile(fixture.paths.preview), previewHashBefore);
  assert.deepEqual(counters.writeCalls || [], []);
};

await withFixture({}, async (fixture) => {
  const result = await runFixtureMigration(fixture);
  assert.equal(result.state, "initial");
  assert.equal(
    await readFile(fixture.paths.legacySource, "utf8"),
    expectedLegacySource
  );
  const expectedCandidate = renderCandidate(expectedLegacySource);
  assert.equal(await readFile(fixture.paths.release, "utf8"), expectedCandidate);
  assert.equal(await readFile(fixture.paths.preview, "utf8"), expectedCandidate);
});

await withFixture(
  { legacySource: expectedLegacySource },
  async (fixture) => {
    const result = await runFixtureMigration(fixture);
    assert.equal(result.state, "resume");
    const expectedCandidate = renderCandidate(expectedLegacySource);
    assert.equal(await readFile(fixture.paths.release, "utf8"), expectedCandidate);
    assert.equal(await readFile(fixture.paths.preview, "utf8"), expectedCandidate);
  }
);

const generatedRoot = renderCandidate(expectedLegacySource);
await withFixture(
  {
    rootSource: generatedRoot,
    legacySource: expectedLegacySource,
    previewSource: "stale-preview\n",
  },
  async (fixture) => {
    const result = await runFixtureMigration(fixture);
    assert.equal(result.state, "generated");
    assert.equal(await readFile(fixture.paths.release, "utf8"), generatedRoot);
    assert.equal(await readFile(fixture.paths.preview, "utf8"), generatedRoot);
  }
);

await withFixture(
  {
    legacySource: expectedLegacySource.replace(
      'console.log("correct source");',
      'console.log("different source");'
    ),
  },
  async (fixture) => {
    const counters = {};
    await assertRejectedWithoutArtifactWrites({
      fixture,
      expectedError: /conflicts with the exact body derived from current S1Plus\.js/,
      counters,
    });
    assert.equal(counters.renderCalls || 0, 0);
  }
);

await withFixture(
  {
    legacySource:
      `(function () {\n  const SCRIPT_VERSION = __S1P_USERSCRIPT_VERSION__;\n  console.log("wrong source");\n})();\n`,
  },
  async (fixture) => {
    const counters = {};
    await assertRejectedWithoutArtifactWrites({
      fixture,
      expectedError: /conflicts with the exact body derived from current S1Plus\.js/,
      counters,
    });
    assert.equal(counters.renderCalls || 0, 0);
  }
);

await withFixture(
  {
    rootSource: generatedRoot,
    legacySource: expectedLegacySource.replace(
      'console.log("correct source");',
      'console.log("wrong generated source");'
    ),
    previewSource: "preview-must-remain\n",
  },
  async (fixture) => {
    const counters = {};
    await assertRejectedWithoutArtifactWrites({
      fixture,
      expectedError: /conflicts with the in-memory candidate/,
      counters,
    });
    assert.equal(counters.renderCalls, 1);
  }
);

console.log(
  "[phase-0.5-source-migration] Initial, resume, generated-idempotent, and conflict/no-overwrite scenarios verified."
);
