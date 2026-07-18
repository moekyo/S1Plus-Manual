import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { splitUserscriptSource } from "./userscript-source.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const sourcePath = path.join(repositoryRoot, "S1Plus.js");
const entryPath = path.join(repositoryRoot, "src", "main.js");
const outputDirectory = path.join(repositoryRoot, "dist");
const outputPath = path.join(outputDirectory, "S1Plus.user.js");
const metafilePath = path.join(outputDirectory, "S1Plus.meta.json");

const assertSafeOutputDirectory = async () => {
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
  const expectedOutputDirectory = path.join(rootRealPath, "dist");
  if (outputDirectoryRealPath !== expectedOutputDirectory) {
    throw new Error("Resolved dist directory is outside the repository root.");
  }
};

const assertTargetIsNotSymlink = async (targetPath) => {
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

const atomicWriteFile = async (targetPath, contents) => {
  await assertTargetIsNotSymlink(targetPath);
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
  } finally {
    await handle.close();
  }

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

await assertSafeOutputDirectory();

const canonicalSource = await readFile(sourcePath, "utf8");
const canonicalParts = splitUserscriptSource(canonicalSource, sourcePath);

const result = await build({
  absWorkingDir: repositoryRoot,
  entryPoints: [entryPath],
  outfile: outputPath,
  bundle: true,
  splitting: false,
  write: false,
  metafile: true,
  format: "iife",
  platform: "browser",
  target: "esnext",
  charset: "utf8",
  legalComments: "inline",
  minify: false,
  sourcemap: false,
  treeShaking: false,
  plugins: [
    {
      name: "s1plus-strip-canonical-metadata",
      setup(buildContext) {
        buildContext.onLoad({ filter: /\.js$/ }, async (args) => {
          if (path.resolve(args.path) !== sourcePath) return null;
          const source = await readFile(args.path, "utf8");
          const { body } = splitUserscriptSource(source, args.path);
          return {
            contents: body,
            loader: "js",
            resolveDir: path.dirname(args.path),
          };
        });
      },
    },
  ],
});

if (result.outputFiles.length !== 1) {
  throw new Error(
    `Expected one userscript bundle, received ${result.outputFiles.length}.`
  );
}

const bundledBody = result.outputFiles[0].text
  .replace(/^\uFEFF/, "")
  .replace(/\r\n?/g, "\n")
  .replace(/^(?:[\t ]*\n)+/, "");
const output = `${canonicalParts.metadata}\n${bundledBody}`;

await atomicWriteFile(outputPath, output);
await atomicWriteFile(metafilePath, `${JSON.stringify(result.metafile, null, 2)}\n`);

console.log(
  `Built ${path.relative(repositoryRoot, outputPath)} (${Buffer.byteLength(
    output
  )} bytes).`
);
