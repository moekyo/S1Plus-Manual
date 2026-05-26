# Sync Title Status Handoff — Grill Session Findings

Date: 2026-05-26  
Source document: `docs/sync-title-status-handoff-review.md`

## Findings Verified Against Code

### Finding 1 ✓ Title handoff is useful, running handoff is dangerous

**Confirmed.** `getAutoSyncRuntimeRunningDisplayState` determines `isRunning` from active locks, in-flight probes, and in-flight foreground follow-ups — all facts about a live worker. `pagehide` releases title presence but NOT sync locks. Other tabs see a fresh lock → `isRunning: true` → display `[同步中...]` with no actual worker.

**Resolution:** "Unsafe to hand off" defined as any title display implying an active runner, including animated states. Result phases (success/failure/conflict) are safe to hand off because they describe an already-recorded outcome.

### Finding 2 ⚡ A closed worker can leave a fresh lock — window is 45s, not "short"

**Confirmed with corrected numbers:**

| Constant | Value |
|---|---|
| `BACKGROUND_SYNC_LOCK_TTL_MS` | 45s |
| `BACKGROUND_SYNC_LOCK_HEARTBEAT_MS` | 10s |
| `AUTO_SYNC_INDICATOR_RUNNING_MIN_VISIBLE_MS` | 650ms (anti-flicker, not relevant) |

**Actual ghost-running window:** worst case 45s. Heartbeat is a `setInterval` destroyed with JS context on tab close. Lock persists in GM storage for full TTL. This is user-visible, not a flicker.

**Recommendation:** Document should say "up to 45 seconds" instead of "short display window." Phase 3 "wait for active lock expiry" should explicitly reference the 45s lock TTL.

### Finding 3 ✓ Old running state falls back to earlier result — constrained window

**Confirmed with additional constraints.** The fallback chain:

```
RUNNING aged → resolveWithTtl(lastResolvedPhase)
  ├─ lastResolvedPhase within TTL → shows old result
  ├─ lastResolvedPhase TTL expired → IDLE
  │   └─ has pending → shows PENDING
  └─ otherwise → IDLE
```

`lastResolvedPhase` comes from the PREVIOUS `finishAutoSyncIndicatorCycle` call — the interrupted run never called `finishAutoSyncIndicatorCycle`, so `lastResolvedPhase` is a pre-existing result, not the interrupted run's outcome.

**Trigger conditions:**
1. Old result TTL still valid (success: 2min, failure: 5min, conflict: 10min for title)
2. No pending dirty request
3. Lock expired without another tab re-running

**Recommendation:** Document should clarify this only happens when old TTL is still valid AND no pending exists — a constrained window, not a guaranteed fallback.

### Finding 4 ✓ Scheduler handoff already exists

**Confirmed.** `releaseSharedBackgroundSyncDebounceOwnerAfterLifecycleFlush` fires on `pagehide`, releasing scheduler ownership. `recoverSharedBackgroundSyncDebounceOwnerIfNeeded` runs on init, recovering ownership. Scheduler handoff is the correct pattern: hand off pending work ownership, don't hand off in-flight operations.

### Finding 5 ✓ Running sync recovery already waits for lock expiry

**Confirmed — no new code needed.** `acquireBackgroundSyncLock` checks existing lock validity against `BACKGROUND_SYNC_LOCK_TTL_MS` (45s). If a valid lock exists, acquisition fails — another tab cannot start a new sync until the old lock expires. Recovery is already "conservative."

**Note:** Lock expiry is from the LAST HEARTBEAT TIMESTAMP, not from tab close. Worst case: heartbeat just refreshed (timestamp = now), tab closes → other tabs must wait full 45s.

### Finding 6 ⚠ Lock checks do not fully fence remote writes — risk is low

**Verified but risk assessment adjusted.** `pushRemoteData`:
1. Fetches remote metadata, compares `updatedAt` with `expectedRemoteUpdatedAt`
2. Sends PATCH
3. Between steps 1 and 2: not atomic

`runWithAutoSyncLockGuard` calls `assertAutoSyncLockOwned` before/after the callback, but NOT after the network response. If a tab closes after PATCH is sent but before response arrives, the remote write may succeed without the tab knowing.

**Actual risk: LOW.** Recovery tab will re-fetch, re-compare hashes, and go through normal conflict detection. Worst case is a duplicate push of the same content (idempotent). The document's "this would increase conflict risk" is imprecise — more accurate phrasing: "may produce duplicate pushes, but data integrity is protected by hash verification."

## Open Questions — Resolved

### Q1: Should navbar keep showing running while title suppresses it?

**Yes.** Navbar and title use same `resolveAutoSyncIndicatorDisplayPhase` but differ via `ttlProfile`. Title will have stricter running detection; navbar keeps existing lock-freshness display. Two different strictness levels per display context.

### Q2: Should title be stricter for all active states or only running?

**Running only.** Pending should also be suppressed in title. Title shows only: result phases (success/failure/conflict) + verified live-runner running. Navbar additionally shows pending.

### Q3: Should navbar expose non-title pending reasons like "等待恢复同步"?

**No.** Diagnostic panel shows full state chain (running / waiting for stale lock / pending recovery scheduled / recovery skipped). Navbar shows simplified: running / pending / results. `waiting for stale lock` folds into pending — users don't need to distinguish "active pending" from "waiting for lock expiry pending." Both mean "will sync soon."

## Implementation Decisions And Result

### Phase 1: Title semantics — implemented

**1.1** Result phase handoff is semantically safe. Implemented a Title Owner lease handoff path so a remaining background tab can acquire the title owner lease for Result Phases when the previous owner is closed, absent from presence, or stale. Cross-tab presence/owner-change refreshes can now explicitly hand off Result Phases without enabling Running Phase takeover.

**1.2** Block running handoff for title unless verified live runner:
- **Approach:** Added `shouldSuppressAutoSyncIndicatorRunningForTitle()` and `getAutoSyncIndicatorLiveRunnerOwnerIdForTitle()`.
- **Logic:** When `ttlProfile === "title"` and the display phase is Running Phase, the title profile requires the current tab to own the active background sync lock. If not, it suppresses to idle for title only.
- **Title Owner rule:** During Running Phase, the Live Runner takes precedence over normal recency-based Title Owner election. Presence records now include `syncOwnerId`, and resolved title running state includes `displayLiveRunnerOwnerId`; `resolveTitleSyncStatusTabDisplayDecision()` matches those to select the Live Runner tab.
- **Boundary:** A non-runner tab suppresses running even if it is the ordinary Title Owner or a stale owner lease still exists.

**1.3** Suppress stale running → old result fallback for title:
- **Logic:** In the running fallback path, when `ttlProfile === "title"`, check `lastResolvedTimestamp >= state.timestamp`. If not, the result is pre-running-cycle and title display suppresses to idle.
- **Guard:** If `lastResolvedTimestamp >= state.timestamp`, result was committed by a resolved-state writer during or after the current running cycle → allow display.

### Phase 2: Scheduler recovery

No code changes needed. `test-background-sync-shared-debounce.js` covers owner release/takeover, lease-expiry recovery, hidden-page recovery, and pending-recovery dedup.

### Phase 3: Running recovery

✅ Existing behavior satisfies all four rules (wait for lock expiry, preserve pending dirty, re-run from fresh snapshots, let conflict/hash checks decide). New diagnostic states (running / waiting for stale lock / pending recovery scheduled / recovery skipped) deferred to diagnostics panel only — not navbar or title.

### Phase 4: Remote write fencing

Deferred. Prerequisite for faster running recovery, not part of current scope.

## Test Matrix — Implemented

All in `tests/test-title-sync-status.js`:

| # | Case | Status |
|---|---|---|
| 1 | One background tab shows running only when it is the Live Runner | Covered |
| 2 | Running Phase owner selection prefers Live Runner over most-recent background tab | Covered |
| 3 | Close title owner during success → transfers to another bg tab | Covered |
| 4 | failure Result Phase keeps normal title display after handoff change | Covered |
| 5 | conflict Result Phase keeps normal title display after handoff change | Covered |
| 6 | Close title owner during running → non-Live Runner does NOT show running | Covered |
| 7 | Stale running title → does NOT fall back to old success/failure/conflict | Covered |
| 8 | Any foreground tab suppresses all title display | Covered |

## Code Change Summary

All changes in `S1Plus.js`:

1. **New functions** `shouldSuppressAutoSyncIndicatorRunningForTitle(displayState, { ttlProfile })` and `getAutoSyncIndicatorLiveRunnerOwnerIdForTitle(now)`. They make title Running Phase depend on a current-tab-owned background sync lock.

2. **Call point** in `resolveAutoSyncIndicatorDisplayPhase` → `finishDisplayState`, alongside existing probe suppression. Title running state receives `displayLiveRunnerOwnerId` only when the current tab is the verified Live Runner.

3. **Presence metadata:** title presence records include `syncOwnerId`, allowing the title owner election to map a Live Runner lock owner back to a live S1 tab.

4. **Title Owner handoff** in title runtime: a remaining background tab can refresh/acquire the title owner lease for Result Phases after the previous owner releases presence, disappears, or has an invalid owner lease. Running handoff remains blocked unless the tab is the Live Runner.

5. **Running owner selection** in title runtime: when display phase is running, prefer the Live Runner over normal recency-based Title Owner election.

6. **Stale fallback guard** in running → `lastResolvedPhase` fallback path: when `ttlProfile === "title"`, check `lastResolvedTimestamp >= state.timestamp` before allowing fallback. If not, suppress to idle.

7. **Export hooks** for new functions and constants to test harness.

## Verification

- `node tests/test-title-sync-status.js`
- `node tests/test-background-sync-shared-debounce.js`
- `node tests/test-safe-sync-execution.js`

## Key Principle

> Results can move between tabs. Running work cannot. Pending work can be recovered.
