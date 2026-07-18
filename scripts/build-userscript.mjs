import { mkdir, readFile, writeFile } from "node:fs/promises";
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

const canonicalSource = await readFile(sourcePath, "utf8");
const { metadata } = splitUserscriptSource(canonicalSource, sourcePath);

await mkdir(outputDirectory, { recursive: true });

const result = await build({
  entryPoints: [entryPath],
  outfile: outputPath,
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["chrome120", "firefox120", "safari17"],
  charset: "utf8",
  legalComments: "none",
  minify: false,
  sourcemap: false,
  treeShaking: true,
  banner: { js: metadata },
  plugins: [
    {
      name: "s1plus-strip-canonical-metadata",
      setup(buildContext) {
        buildContext.onLoad(
          { filter: /(?:^|[\\/])S1Plus\.js$/ },
          async (args) => {
            const source = await readFile(args.path, "utf8");
            const { body } = splitUserscriptSource(source, args.path);
            return {
              contents: body,
              loader: "js",
              resolveDir: path.dirname(args.path),
            };
          }
        );
      },
    },
  ],
});

if (result.outputFiles.length !== 1) {
  throw new Error(
    `Expected one userscript bundle, received ${result.outputFiles.length}.`
  );
}

const output = result.outputFiles[0].text.replace(/^\uFEFF/, "");
await writeFile(outputPath, output, "utf8");

console.log(
  `Built ${path.relative(repositoryRoot, outputPath)} (${Buffer.byteLength(
    output
  )} bytes).`
);
