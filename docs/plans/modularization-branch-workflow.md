# S1 Plus modularization branch workflow

## Status

- Long-lived modularization integration branch: `codex/s1plus-modularization-foundation`
- Stable product baseline: `main`
- Phase 0: completed on the integration branch; local automated gates and Tampermonkey + Stage1st smoke test passed.
- Next technical stage: Phase 0.5 generated-root cutover, not started by this document change.
- GitHub Actions are not used for this migration; stage gates remain local.

This document is authoritative for the **branch lifecycle** of the modularization program. It complements `docs/plans/userscript-modularization.md`, which remains authoritative for technical scope, source ownership, phase gates, rollback, and release architecture.

Any earlier assumption that Phase 0 must first merge into `main` before Phase 0.5 is superseded by this workflow.

## Branch model

```text
main
  └─ codex/s1plus-modularization-foundation       long-lived integration branch
       ├─ <dedicated Phase 0.5 branch>             stage implementation branch
       ├─ <dedicated Phase 1 branch>               stage implementation branch
       ├─ <dedicated Phase 2 branch>               stage implementation branch
       └─ ...
```

The integration branch accumulates completed modularization stages. Each new stage starts from the latest integration-branch head, is implemented and verified on its own stage branch, and is then merged back into the integration branch.

`main` is not the merge target for intermediate modularization stages. The integration branch is merged into `main` only after the complete modularization program and its final regression, release, and browser gates pass.

## Stage workflow

For every stage after Phase 0:

1. Confirm `codex/s1plus-modularization-foundation` is current, clean, and contains all previously accepted stages.
2. Create one dedicated stage branch from that exact integration-branch head.
3. Implement only that stage's approved scope on the stage branch.
4. Run the stage-specific local automated gates, representative regression tests, and required browser evidence.
5. Review source ownership, generated artifacts, rollback safety, and documentation before declaring the stage complete.
6. Merge the completed stage branch back into `codex/s1plus-modularization-foundation`.
7. Start the next stage branch only from the updated integration branch, never from an unmerged earlier stage branch.

A stage branch must not target `main`, and unrelated product work must not be mixed into a modularization stage branch.

## Integration branch rules

`codex/s1plus-modularization-foundation` is the canonical integration history for the modularization program.

- Keep accepted stage results and required cross-stage fixes on this branch.
- Do not perform normal next-stage implementation directly on this branch; use a dedicated stage branch.
- Do not create stacked stage branches where a later stage depends on an unmerged earlier stage branch.
- Do not begin a later technical phase until the previous phase is merged back and its closure is recorded.
- Do not use the integration branch for unrelated features, broad cleanup, or release work outside the modularization plan.
- Do not add GitHub Actions or make CI a phase gate.

Small integration-only changes are limited to branch-policy documentation, conflict resolution required to preserve accepted stages, and narrowly scoped fixes discovered while validating an already merged stage. Such fixes must rerun the affected local gates.

## Synchronizing `main`

If `main` receives necessary product or safety changes while modularization is in progress:

1. Review the incoming commits for ownership or migration conflicts.
2. Integrate the required `main` changes into `codex/s1plus-modularization-foundation` deliberately.
3. Rerun the affected modularization gates before creating the next stage branch.
4. Do not silently overwrite either the stable product change or accepted modularization work.

Routine unrelated changes do not justify abandoning the integration branch or merging unfinished modularization into `main`.

## Final merge to `main`

The integration branch may merge into `main` only after:

- all planned modularization phases are complete and integrated;
- the generated-root and single-source ownership model is stable;
- full local automated verification passes;
- representative CommonJS/module/bundle regressions pass;
- formal release drift checks pass;
- Tampermonkey installation and Stage1st browser regression evidence pass;
- no unfinished stage branches are required for correctness;
- the final integration diff contains no unrelated work.

Until then:

```text
main remains the stable baseline.
codex/s1plus-modularization-foundation remains the modularization integration branch.
Each new phase uses a dedicated child branch and merges back into the integration branch.
```
