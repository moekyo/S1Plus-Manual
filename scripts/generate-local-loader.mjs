import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
export const repoRoot = path.resolve(path.dirname(scriptPath), "..");

const MAIN_SCRIPT = "S1Plus.js";
const LOADER_VERSION = "99.9.10";
const LOCAL_RESOURCE_FILES = new Map([
  ["s1p-base-css", "S1Plus.css"],
  ["s1p-static-data", "S1Plus-static-data.json"],
]);

const PLATFORM_CONFIG = {
  darwin: {
    fileName: "S1Plus-Local-Mac.user.js",
    name: "S1 Plus (Local Mac)",
    description: "本地开发版，直接加载磁盘文件（macOS）",
    label: "macOS",
  },
  win32: {
    fileName: "S1Plus-Local-Windows.user.js",
    name: "S1 Plus (Local Windows)",
    description: "本地开发版，直接加载磁盘文件（Windows）",
    label: "Windows",
  },
};

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

const parseMetadataValue = (value) => {
  const separatorIndex = value.indexOf(" ");
  if (separatorIndex < 0) {
    return { name: value, value: "" };
  }
  return {
    name: value.slice(0, separatorIndex),
    value: value.slice(separatorIndex + 1).trim(),
  };
};

const getPlatformConfig = (platform) => {
  const config = PLATFORM_CONFIG[platform];
  if (!config) {
    throw new Error(
      `Unsupported platform ${platform}; use darwin or win32 to generate a local loader.`
    );
  }
  return config;
};

const requireFile = (projectRoot, fileName) => {
  const filePath = path.join(projectRoot, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required local file is missing: ${fileName}`);
  }
  return filePath;
};

const toLocalFileUrl = (filePath) => pathToFileURL(filePath).href;

export const buildLocalLoader = ({
  projectRoot = repoRoot,
  platform = process.platform,
} = {}) => {
  const config = getPlatformConfig(platform);
  const mainScriptPath = requireFile(projectRoot, MAIN_SCRIPT);
  const mainMetadata = readMetadata(fs.readFileSync(mainScriptPath, "utf8"));
  const mainResources = new Map(
    (mainMetadata.get("resource") || []).map(parseMetadataValue).map(({ name, value }) => [name, value])
  );

  for (const [resourceName, fileName] of LOCAL_RESOURCE_FILES) {
    if (!mainResources.has(resourceName)) {
      throw new Error(`Main script is missing the @resource ${resourceName} declaration.`);
    }
    requireFile(projectRoot, fileName);
  }

  const lines = [
    "// ==UserScript==",
    `// @name         ${config.name}`,
    "// @namespace    http://tampermonkey.net/",
    `// @version      ${LOADER_VERSION}`,
    `// @description  ${config.description}`,
    "// @author       Antigravity",
    ...(mainMetadata.get("match") || []).map((value) => `// @match        ${value}`),
    `// @require      ${toLocalFileUrl(mainScriptPath)}`,
    ...[...LOCAL_RESOURCE_FILES].map(([resourceName, fileName]) =>
      `// @resource     ${resourceName} ${toLocalFileUrl(path.join(projectRoot, fileName))}`
    ),
    ...(mainMetadata.get("grant") || []).map((value) => `// @grant        ${value}`),
    ...(mainMetadata.get("connect") || []).map((value) => `// @connect      ${value}`),
    ...(mainMetadata.get("run-at") || []).map((value) => `// @run-at       ${value}`),
    "// ==/UserScript==",
    "",
    "(function () {",
    '  "use strict";',
    `  console.log("[S1 Plus] ${config.label} 本地加载器已启动");`,
    "})();",
    "",
  ];

  return {
    fileName: config.fileName,
    content: lines.join("\n"),
  };
};

export const writeLocalLoader = ({
  projectRoot = repoRoot,
  outputDirectory = projectRoot,
  platform = process.platform,
} = {}) => {
  const loader = buildLocalLoader({ projectRoot, platform });
  const outputPath = path.join(outputDirectory, loader.fileName);
  fs.writeFileSync(outputPath, loader.content, "utf8");
  return { ...loader, outputPath };
};

const normalizePlatformArgument = (value) => {
  if (!value) return process.platform;
  if (value === "mac") return "darwin";
  if (value === "windows") return "win32";
  return value;
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const platform = normalizePlatformArgument(process.argv[2]);
  const result = writeLocalLoader({ platform });
  console.log(`Generated ${result.outputPath}`);
}
