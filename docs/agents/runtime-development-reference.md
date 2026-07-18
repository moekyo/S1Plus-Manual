# Historical runtime development reference

> [!WARNING]
> This is a historical-reference index, not an active development guide.
>
> The preserved Phase 0 baseline document contains useful runtime details, but
> its statements about project shape, build commands, local loaders, source
> ownership, dependency policy, and release workflow are superseded. Do not
> follow those sections.
>
> Active instructions are defined by `AGENTS.md`, `DEVELOPMENT.md`,
> `docs/agents/repository-guide.md`, and
> `docs/plans/userscript-modularization.md`.

## Valid use

Use the historical baseline only when current documents do not repeat the
required implementation detail, especially for:

- synchronization behavior and diagnostic fields
- Greasemonkey storage and lock-key catalogs
- initialization phases and lifecycle ordering
- settings, glass/UI, tooltip, image-viewer, and debug-panel details
- focused runtime and source-structure test inventories

Before applying any historical detail, verify it against the current
`S1Plus.js` implementation. The historical document is descriptive context, not
authority to recreate old ownership or bypass the current build gates.

## Superseded topics

The following historical sections are explicitly invalid as current workflow
instructions:

- “no build or compilation step”
- “avoid build-time dependencies”
- unconditional direct editing of root `S1Plus.js`
- local-loader instructions after the planned Phase 0.5 cutover
- release instructions that omit local bundle verification

During Phase 0, runtime code is still edited in root `S1Plus.js`, but build
changes require `npm ci` and `npm run verify:bundle`. Before any production code
moves to `src/`, the generated-root cutover in the modularization plan must be
completed.

## Preserved baseline

The complete historical guide remains available at the exact pre-foundation
baseline:

- [`DEVELOPMENT.md` at `f13b2d548c57f96834944f15b1dc5e9a16e45303`](https://github.com/moekyo/S1Plus-Manual/blob/f13b2d548c57f96834944f15b1dc5e9a16e45303/DEVELOPMENT.md)

Read only the runtime sections needed for the task, then return to the current
repository instructions before editing, building, testing, or releasing.
