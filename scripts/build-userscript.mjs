import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  assertSafeOutputDirectory,
  atomicWriteFile,
} from "./userscript-output.mjs";
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

await assertSafeOutputDirectory({ repositoryRoot, outputDirectory });

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
