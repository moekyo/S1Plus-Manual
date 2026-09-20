const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

const loadGenerator = () => import("../scripts/generate-local-loader.mjs");

(async () => {
  // Shared with the generator so the two cannot drift into disagreeing parsers.
  // A duplicated copy here previously parsed nothing at all on Windows.
  const { buildLocalLoader, readMetadata } = await loadGenerator();

  const mainSource = fs.readFileSync(path.join(repoRoot, "S1Plus.js"), "utf8");
  const mainMetadata = readMetadata(mainSource);
  const requiredGrants = mainMetadata.get("grant") || [];

  // Regression guard: Windows checkouts produce CRLF sources, and a line-anchored
  // metadata regex silently matched nothing there.
  const crlfMetadata = readMetadata(mainSource.replace(/\r?\n/g, "\r\n"));
  assert.deepEqual(
    crlfMetadata.get("resource"),
    mainMetadata.get("resource"),
    "metadata parsing must be independent of CRLF line endings"
  );
  assert.equal(
    (crlfMetadata.get("grant") || []).length,
    requiredGrants.length,
    "every @grant must survive a CRLF source"
  );

  const expectedLoaders = [
    { platform: "darwin", fileName: "S1Plus-Local-Mac.user.js" },
    { platform: "win32", fileName: "S1Plus-Local-Windows.user.js" },
  ];

  for (const { platform, fileName } of expectedLoaders) {
    const { fileName: generatedFileName, content } = buildLocalLoader({
      platform,
      projectRoot: repoRoot,
    });
    assert.equal(generatedFileName, fileName);

    const metadata = readMetadata(content);
    const grants = metadata.get("grant") || [];
    const requires = metadata.get("require") || [];
    const resources = metadata.get("resource") || [];

    assert.ok(
      requires.some((value) => value.startsWith("file:") && value.endsWith("/S1Plus.js")),
      `${fileName} must require the local main S1Plus.js source`
    );
    assert.ok(
      resources.some((value) => value.startsWith("s1p-base-css file:")),
      `${fileName} must provide the local stylesheet resource`
    );
    assert.ok(
      resources.some((value) => value.startsWith("s1p-static-data file:")),
      `${fileName} must provide the local static-data resource`
    );

    for (const grant of requiredGrants) {
      assert.ok(
        grants.includes(grant),
        `${fileName} is missing the ${grant} grant required by S1Plus.js`
      );
    }

    for (const connect of mainMetadata.get("connect") || []) {
      assert.ok(
        (metadata.get("connect") || []).includes(connect),
        `${fileName} is missing the @connect ${connect} declaration`
      );
    }
  }

  const generatorSource = fs.readFileSync(
    path.join(repoRoot, "scripts/generate-local-loader.mjs"),
    "utf8"
  );
  assert.doesNotMatch(generatorSource, /\/Users\/[^/]+\/Development\//);
  assert.doesNotMatch(generatorSource, /[A-Z]:\\Development\\/);

  console.log("Local loader generator metadata checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
