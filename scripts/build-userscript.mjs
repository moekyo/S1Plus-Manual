import { buildUserscript } from "./userscript-build.mjs";

const targetArgument = process.argv.find((argument) =>
  argument.startsWith("--target=")
);
const target = targetArgument ? targetArgument.slice("--target=".length) : "preview";

await buildUserscript({ target });
