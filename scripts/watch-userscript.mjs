import { watch } from "node:fs";
import path from "node:path";
import { buildUserscript, repositoryRoot } from "./userscript-build.mjs";

const watchTargets = [
  { path: path.join(repositoryRoot, "src"), recursive: true },
  { path: path.join(repositoryRoot, "userscript.config.mjs"), recursive: false },
];

let buildRunning = false;
let rebuildQueued = false;
let debounceTimer = null;

const rebuild = async () => {
  if (buildRunning) {
    rebuildQueued = true;
    return;
  }

  buildRunning = true;
  try {
    await buildUserscript({ target: "preview" });
  } catch (error) {
    console.error(`[userscript-dev] Preview rebuild failed: ${error.stack || error}`);
  } finally {
    buildRunning = false;
    if (rebuildQueued) {
      rebuildQueued = false;
      await rebuild();
    }
  }
};

const scheduleRebuild = () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void rebuild();
  }, 120);
};

await rebuild();

const watchers = watchTargets.map((target) =>
  watch(target.path, { recursive: target.recursive }, scheduleRebuild)
);

console.log(
  "[userscript-dev] Watching src/ and userscript.config.mjs; rebuilding dist/S1Plus.user.js."
);

const stop = () => {
  clearTimeout(debounceTimer);
  for (const watcher of watchers) watcher.close();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

await new Promise(() => {});
