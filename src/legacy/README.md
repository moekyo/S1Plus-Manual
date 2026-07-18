# Legacy source ownership

`src/legacy/main.js` is the temporary single owner of the complete unmigrated
S1 Plus userscript body after the Phase 0.5 generated-root cutover.

Phase 0.5 rules:

- move the existing body intact; do not extract, reorder, rename, or redesign business functions
- userscript metadata and the runtime version value come from `userscript.config.mjs`
- `src/main.js` imports this file only for side effects
- root `S1Plus.js` and `dist/S1Plus.user.js` are generated from the same entry/config
- never keep a second editable implementation in root `S1Plus.js`
- later phase branches may move one approved ownership boundary at a time out of this file

Do not install or execute this source file directly. Use the generated root artifact
for formal installation and `dist/S1Plus.user.js` through the local loader for development.
