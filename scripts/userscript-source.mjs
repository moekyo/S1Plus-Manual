const USERSCRIPT_METADATA_PATTERN =
  /^\/\/ ==UserScript==\r?\n[\s\S]*?^\/\/ ==\/UserScript==(?:\r?\n)?/m;

export const splitUserscriptSource = (source, filePath = "userscript source") => {
  const metadataMatch = String(source).match(USERSCRIPT_METADATA_PATTERN);
  if (!metadataMatch || metadataMatch.index !== 0) {
    throw new Error(
      `Userscript metadata must be the first block in ${filePath}.`
    );
  }

  return Object.freeze({
    metadata: metadataMatch[0].trimEnd(),
    body: String(source).slice(metadataMatch[0].length),
  });
};

export const normalizeUserscriptMetadata = (metadata) =>
  String(metadata).replace(/\r\n/g, "\n").trimEnd();

export const countUserscriptMetadataBlocks = (source) =>
  (String(source).match(/\/\/ ==UserScript==/g) || []).length;
