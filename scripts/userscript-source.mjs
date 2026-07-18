export const USERSCRIPT_METADATA_START = "// ==UserScript==";
export const USERSCRIPT_METADATA_END = "// ==/UserScript==";

export const normalizeLineEndings = (value) =>
  String(value).replace(/\r\n?/g, "\n");

const markerLineIndices = (lines, marker) =>
  lines.reduce((indices, line, index) => {
    if (line === marker) indices.push(index);
    return indices;
  }, []);

export const splitUserscriptSource = (
  source,
  filePath = "userscript source"
) => {
  const raw = String(source);
  const withoutBom = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  const normalized = normalizeLineEndings(withoutBom);
  const lines = normalized.split("\n");

  if (lines[0] !== USERSCRIPT_METADATA_START) {
    throw new Error(
      `Userscript metadata must begin at the first byte of ${filePath}.`
    );
  }

  const startIndices = markerLineIndices(lines, USERSCRIPT_METADATA_START);
  const endIndices = markerLineIndices(lines, USERSCRIPT_METADATA_END);
  if (startIndices.length !== 1) {
    throw new Error(
      `${filePath} must contain exactly one userscript metadata start marker.`
    );
  }
  if (endIndices.length !== 1) {
    throw new Error(
      `${filePath} must contain exactly one userscript metadata end marker.`
    );
  }

  const endIndex = endIndices[0];
  if (endIndex <= 0) {
    throw new Error(`Userscript metadata is malformed in ${filePath}.`);
  }

  const metadataLines = lines.slice(0, endIndex + 1);
  for (const [offset, line] of metadataLines.slice(1, -1).entries()) {
    if (!line.startsWith("//")) {
      throw new Error(
        `Userscript metadata line ${offset + 2} in ${filePath} is not a comment.`
      );
    }
  }

  const bodyLines = lines.slice(endIndex + 1);
  while (bodyLines.length > 0 && /^[\t ]*$/.test(bodyLines[0])) {
    bodyLines.shift();
  }

  const metadata = metadataLines.join("\n");
  const body = bodyLines.join("\n");
  const directives = Object.freeze(
    metadataLines.slice(1, -1).filter((line) => /^\/\/\s+@\S/.test(line))
  );

  return Object.freeze({
    metadata,
    directives,
    body,
    source: body ? `${metadata}\n${body}` : `${metadata}\n`,
    hadBom: raw.startsWith("\uFEFF"),
  });
};

export const getUserscriptMetadataValue = (parts, directiveName) => {
  const prefix = `// @${directiveName}`;
  const matches = parts.directives.filter(
    (line) => line === prefix || line.startsWith(`${prefix} `)
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one @${directiveName} directive, received ${matches.length}.`
    );
  }
  return matches[0].slice(prefix.length).trim();
};
