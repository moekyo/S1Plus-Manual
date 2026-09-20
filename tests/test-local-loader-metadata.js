const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

const readMetadata = (fileName) => {
  const source = fs.readFileSync(path.join(repoRoot, fileName), "utf8");
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

const mainMetadata = readMetadata("S1Plus.js");
const requiredGrants = mainMetadata.get("grant") || [];

const localLoaders = [
  {
    fileName: "S1Plus-Local-Mac.user.js",
    staticDataResource:
      "s1p-static-data file:///Users/rexxin/Development/S1Plus-Manual/S1Plus-static-data.json",
  },
  {
    fileName: "S1Plus-Local-Windows.user.js",
    staticDataResource:
      "s1p-static-data file:///D:/Development/S1Plus-Manual/S1Plus-static-data.json",
  },
];

for (const { fileName, staticDataResource } of localLoaders) {
  const metadata = readMetadata(fileName);
  const grants = metadata.get("grant") || [];

  assert.ok(
    (metadata.get("require") || []).some((value) => value.endsWith("/S1Plus.js")),
    `${fileName} must require the main S1Plus.js source`
  );
  assert.ok(
    (metadata.get("resource") || []).some((value) =>
      value.startsWith("s1p-base-css file:")
    ),
    `${fileName} must provide the local stylesheet resource`
  );
  assert.ok(
    (metadata.get("resource") || []).includes(staticDataResource),
    `${fileName} must provide the local static-data resource`
  );

  for (const grant of requiredGrants) {
    assert.ok(
      grants.includes(grant),
      `${fileName} is missing the ${grant} grant required by S1Plus.js`
    );
  }
}

console.log("Local loader metadata checks passed.");
