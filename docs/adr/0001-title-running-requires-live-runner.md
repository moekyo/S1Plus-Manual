# Title Running Display Requires Verified Live Runner

Title status display for the "running" phase (`[同步中...]`) must verify that the current tab is the actual sync lock owner. A fresh sync lock alone is insufficient evidence — the lock can persist for up to 45 seconds after its owner tab closes (heartbeat is a `setInterval` destroyed with the JS context), creating a ghost running title that implies active work when none exists. The trade-off is between continuity (showing running as long as any lock exists) and accuracy (only showing running when a demonstrable live runner exists). We choose accuracy for the title because the title is a passive notification channel seen when all S1 tabs are backgrounded — misleading information here erodes trust more than a brief idle gap.

For running title display, the Live Runner takes precedence over the normal recency-based Title Owner election. A non-runner Title Owner must suppress the running prefix rather than inherit it. Result phases keep the normal Title Owner handoff behavior.

This applies only to the title projection surface (`surface: "title"`). The navbar indicator retains the less strict lock-freshness display because the user is actively looking at the page and can interpret a short running display after tab switch as transitional.

Implementation notes:

- Title Running Phase suppression is enforced by `readSyncIndicatorStateProjection({ surface: "title" })` through the internal `projectSyncIndicatorState()` policy.
- A verified Live Runner contributes `displayLiveRunnerOwnerId` to the resolved title state.
- Title presence records include `syncOwnerId`, allowing `resolveTitleSyncStatusTabDisplayDecision()` to choose the Live Runner tab before ordinary recency-based Title Owner selection.
- Result Phases can still hand off through the Title Owner lease path; this handoff path does not apply to Running Phase.
- Stale Running Phase does not fall back to an older Result Phase for title display.

**Status:** accepted

**Implementation:** completed 2026-05-26
