# Generated userscript output

`dist/S1Plus.user.js` and `dist/S1Plus.meta.json` are generated preview artifacts and remain intentionally ignored by Git.

During and after the Phase 0.5 cutover:

- `src/main.js` + `src/legacy/main.js` + `userscript.config.mjs` are the build inputs
- `dist/S1Plus.user.js` is the local-loader preview artifact
- root `S1Plus.js` is the committed formal release artifact
- preview and root must be byte-identical because they use the same build core
- neither generated userscript may be edited manually

Commands:

```bash
npm ci
npm run build:preview
npm run dev
npm run build:release
npm run verify:bundle
npm run verify:release
```

`npm run verify:bundle` rebuilds preview and root, validates metadata/version,
checks the exact two-file source graph, runs generated-root/preview VM parity and
stable behavior probes, confirms deterministic output, and validates both local
loaders.

`npm run verify:release` additionally requires the generated ownership files to
be tracked and clean after rebuilding. GitHub Actions are not used; release and
browser gates remain local.
