const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

const readMetadata = (source) => {
  const metadata = new Map();
  for (const line of source.split("\n")) {
    const match = line.match(/^\/\/ @(\S+)\s+(.+)$/);
    if (!match) continue;
    const [, key, value] = match;
    const values = metadata.get(key) || [];
    values.push(value.trim());
    metadata.set(key, values);
  }
  return metadata;
};

const readGeneratedLoader = async (platform) => {
  const { buildLocalLoader } = await import("../scripts/generate-local-loader.mjs");
  return buildLocalLoader({ platform, projectRoot: repoRoot });
};

(async () => {
  const mainSource = fs.readFileSync(path.join(repoRoot, "S1Plus.js"), "utf8");
  const mainMetadata = readMetadata(mainSource);
  const requiredGrants = mainMetadata.get("grant") || [];

  const expectedLoaders = [
    { platform: "darwin", fileName: "S1Plus-Local-Mac.user.js" },
    { platform: "win32", fileName: "S1Plus-Local-Windows.user.js" },
  ];

  for (const { platform, fileName } of expectedLoaders) {
    const { fileName: generatedFileName, content } = await readGeneratedLoader(platform);
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
