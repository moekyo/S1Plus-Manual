# Sync Title Status And Handoff Review

Date: 2026-05-26

## Background

S1 Plus has two related but separate concerns:

- Sync execution: decide when to push, pull, probe, retry, or pause remote sync.
- Status display: show sync state in the navbar and, optionally, in the browser tab title when all S1 tabs are in the background.

The observed issue is about tab title status continuity. When the S1 tab currently displaying a title status is closed, the title status disappears even if other S1 tabs still exist. That raised a broader question: should status display and running sync work both hand off to another S1 tab?

## User Need

When multiple S1 tabs exist, closing the tab that currently owns the title status should not make important sync information vanish.

Expected user-facing behavior:

- Completed results such as sync success, failure, or conflict may move to another background S1 tab and remain visible for their TTL.
- Running status must only mean that a real sync task is still credibly running.
- If the tab running a sync is closed, another tab should not simply inherit `[同步中]`.
- If the old task was interrupted, another tab may recover later by rechecking state and rerunning sync safely.
- If the old task actually finished, the result should be shown only when a resolved-state writer recorded it, not inferred from a stale running state.

## Current Map

### Local Dirty Signal

Local changes, especially read progress changes, update `LAST_LOCAL_MODIFIED_KEY` and record a pending auto-sync request in `PENDING_AUTO_SYNC_KEY`.

Relevant code:

- `markPendingAutoSyncRequest()`
- `recoverPendingAutoSyncIfNeeded()`
- `requestBackgroundSyncRun()`

### Shared Background Scheduler

Background push scheduling is coordinated through `s1p_background_sync_debounce_state`.

The shared scheduler stores:

- dirty source information
- debounce due time
- max wait time
- scheduler owner tab id
- owner lease
- generation

The scheduler can already hand off timer ownership when an owner disappears or its lease expires.

Relevant code:

- `requestSharedBackgroundSyncDebounce()`
- `tryAcquireBackgroundSyncDebounceOwner()`
- `recoverSharedBackgroundSyncDebounceOwnerIfNeeded()`
- `releaseSharedBackgroundSyncDebounceOwnerAfterLifecycleFlush()`

### Sync Execution Lock

Actual sync execution uses per-mode locks plus a global lock.

Modes:

- `background`
- `startup`
- `manual`

The background execution path:

1. `triggerRemoteSyncPush()`
2. `acquireBackgroundSyncLock()`
3. `startBackgroundSyncLockHeartbeat()`
4. `performAutoSync()`
5. `stopBackgroundSyncLockHeartbeat()`
6. `releaseBackgroundSyncLock()`

This protects active execution from duplicate syncs, but it does not make an in-flight Promise transferable to another tab.

### Sync Indicator State

`AUTO_SYNC_INDICATOR_STATE_KEY` stores the shared Sync Indicator State used by the navbar and title status.

The effective display phase is derived from:

- the persisted Sync Indicator State
- active sync locks
- pending retry/debounce state
- pending auto-sync request state
- foreground probe state
- result TTLs

Relevant code:

- `resolveAutoSyncIndicatorDisplayPhase()`
- `getAutoSyncRuntimeRunningDisplayState()`
- `getAutoSyncRuntimePendingDisplayState()`
- `startAutoSyncIndicatorCycle()`
- `finishAutoSyncIndicatorCycle()`

### Title Status Layer

The title status layer tracks S1 tab presence and chooses one background tab as title owner.

It stores:

- partitioned per-tab presence keys
- aggregate presence mirror
- per-tab sync owner id (`syncOwnerId`) so the title layer can map a Live Runner lock owner back to a tab presence record
- title owner lease
- title owner token

It displays only when:

- remote sync is enabled
- title sync status setting is enabled
- all live S1 tabs are in the background
- this tab is the title owner
- the Sync Indicator State display phase maps to a title prefix

Relevant code:

- `writeCurrentTitleSyncStatusPresence()`
- `resolveTitleSyncStatusTabDisplayDecision()`
- `maybeRefreshTitleSyncStatusOwnerLease()`
- `releaseTitleSyncStatusPresenceAndDisplay()`

## Findings

### 1. Title handoff is useful, but running handoff is dangerous

Result phases are safe to hand off because they describe an already recorded outcome.

Safe to hand off:

- `[同步成功]`
- `[同步失败]`
- `[冲突]`

Unsafe to hand off blindly:

- `[同步中.]`
- `[同步中..]`
- `[同步中...]`

Reason: running is a fact about an active worker, not just a notification. If the worker tab closes, the Promise cannot be migrated to another tab.

### 2. A closed worker can leave a fresh lock — window is up to 45 seconds

The display resolver treats a fresh sync lock as running. This is useful for navbar continuity, but it can become misleading for title handoff.

When the running tab closes:

- its JS context stops (`setInterval` heartbeat is destroyed)
- the lock timestamp persists in GM storage
- the lock remains "fresh" for its full 45s TTL (`BACKGROUND_SYNC_LOCK_TTL_MS`)
- another tab may see the fresh lock and display running

This can create a ghost running title for up to 45 seconds: the title says sync is running, but no live tab is actually executing it. The ghost window is user-visible — worst case is a heartbeat refresh just before tab close, followed by the full 45s TTL.

> See grill findings: [sync-title-status-grill-findings.md](./sync-title-status-grill-findings.md#finding-2--a-closed-worker-can-leave-a-fresh-lock--window-is-45s-not-short)

### 3. Old running state may fall back to an older result — constrained window

When a running state is no longer supported by an active running signal, the unified display resolver may fall back to `lastResolvedPhase`.

This can show an older success/failure/conflict after a newer running sync was interrupted. That is not as bad as ghost running, but it can still imply that the interrupted run completed.

**Constraints:** This only occurs when (1) the old result TTL is still valid (success: 2min, failure: 5min, conflict: 10min for title), AND (2) no pending dirty request exists to take priority, AND (3) no other tab has recovered and rerun. The `lastResolvedPhase` value comes from a previous resolved-state write — the interrupted run never committed a Result Phase, so its outcome is not in `lastResolvedPhase`.

**Implemented behavior:** for the title profile, stale running no longer falls back to an older Result Phase when `lastResolvedTimestamp < state.timestamp`. The title goes idle until a resolved-state writer commits a new Result Phase or pending recovery produces a new state.

> See grill findings: [sync-title-status-grill-findings.md](./sync-title-status-grill-findings.md#finding-3--old-running-state-falls-back-to-earlier-result--constrained-window)

### 4. Scheduler handoff already exists

The shared background scheduler already supports owner lease and recovery. Closing the scheduler owner should not lose a pending dirty push as long as the shared debounce state remains.

This is the correct kind of handoff:

- hand off pending work ownership
- do not hand off an in-flight network operation

### 5. Running sync recovery should wait for lock expiry — already the current behavior

Immediate takeover is unsafe because closing a tab does not guarantee its already-sent network request is dead. A PATCH request may still complete after another tab starts a new sync.

`acquireBackgroundSyncLock` already checks existing lock validity against `BACKGROUND_SYNC_LOCK_TTL_MS` (45s). If a valid lock exists, acquisition fails — no new sync can start until the old lock expires. Recovery is already conservative.

**Note:** Lock expiry is measured from the LAST HEARTBEAT TIMESTAMP, not from tab close. A heartbeat just refreshed (timestamp = now) followed by immediate tab close means other tabs must wait the full 45s.

Safer behavior:

1. Keep the old lock until it expires.
2. Preserve pending dirty state.
3. Let another tab recover after the old lock is stale.
4. Re-run sync from fresh local and remote snapshots.
5. Let hash/version/conflict checks decide the outcome.

### 6. Lock checks do not fully fence remote writes — risk is low

`performAutoSync()` checks lock ownership before and after guarded async stages. This helps stop local follow-up work after lock loss.

However, `pushRemoteData()` currently performs a metadata check and then sends a PATCH. That remote write is not atomic with the local lock. If an old request completes after its lock expired, the lock guard cannot undo the remote write.

**Risk assessment adjusted:** Recovery tab will re-fetch, re-compare hashes, and go through normal conflict detection. Worst case is a duplicate push of the same content (idempotent). Data integrity is protected by hash verification. Shrinking the takeover window carries low risk rather than meaningfully increasing conflict risk.

> See grill findings: [sync-title-status-grill-findings.md](./sync-title-status-grill-findings.md#finding-6--lock-checks-do-not-fully-fence-remote-writes--risk-is-low)

## Product Semantics

### Title Status

Title status should distinguish result display from active execution display.

Rules:

- Result phases may hand off to another background S1 tab.
- Pending phases should not show a title prefix.
- Running phase should display in title only on the Live Runner. For running, Live Runner ownership takes precedence over the normal recency-based Title Owner election.
- A stale running state should not fall back to an old success result for title display.
- If there is no credible live runner, title display should go idle while recovery proceeds internally.

### Sync Execution

Running sync should not be transferred between tabs.

Rules:

- Do not clear execution locks on `pagehide` or `beforeunload`.
- Do not start another execution while a previous lock is still valid.
- Preserve pending dirty state for recovery.
- Recover by rerunning sync after lock expiry.
- Use fresh local and remote snapshots during recovery.
- Let normal conflict, hash, and clean-state fences decide whether recovery is a no-op, success, failure, or conflict.

## Implementation Status

### Phase 1: Title semantics — implemented

- Added a Title Owner lease handoff path for Result Phases when the previous owner closes, disappears from presence, or has an invalid/expired lease.
- `resolveAutoSyncIndicatorDisplayPhase(..., { ttlProfile: "title" })` now suppresses Running Phase unless the current tab is the Live Runner.
- Running Title Owner selection now prefers the Live Runner by matching the title display state's `displayLiveRunnerOwnerId` with each presence record's `syncOwnerId`.
- Non-runner tabs suppress Running Phase even if ordinary recency or an old owner lease would otherwise select them.
- Stale running fallback to an older `lastResolvedPhase` is blocked for the title profile unless that result was committed at or after the running cycle started.
- Tests were added in `tests/test-title-sync-status.js`.

### Phase 2: Scheduler recovery — verified, no code change

- Existing shared scheduler owner recovery behavior remains unchanged.
- Verified with `node tests/test-background-sync-shared-debounce.js`.

### Phase 3: Running recovery — unchanged by design

- No immediate running takeover was added.
- Background sync lock expiry remains the recovery fence.
- Pending dirty and shared scheduler recovery continue to drive later safe retries.
- Verified with `node tests/test-safe-sync-execution.js`.

### Phase 4: Optional remote write fencing

Only consider faster running recovery if remote writes gain stronger fencing.

Possible approaches:

- Add sync generation or operation token to `syncMeta`.
- After PATCH, refetch remote metadata/content and verify that the expected writer token is present.
- Treat unverified writes as uncertain and force a probe or manual conflict path.
- If GitHub API support allows it, prefer conditional requests over check-then-PATCH.

## Test Matrix

### Title status

- Verified: one background S1 tab shows running only when it is the Live Runner.
- Verified: Result Phase ownership uses the ordinary title owner election and can hand off.
- Verified: closing the Title Owner during success transfers success to another background S1 tab.
- Verified: failure and conflict Result Phases keep normal title display behavior after the handoff change.
- Verified: closing the Title Owner during Running Phase does not transfer running to a non-Live Runner.
- Verified: when the real Live Runner is still alive, title owner selection prefers the Live Runner over recency.
- Verified: stale running title does not fall back to an old success/failure/conflict.
- Verified: any foreground S1 tab suppresses all title status display.

### Shared scheduler

- Owner tab release clears owner and another tab can acquire.
- Lease expiry recovery schedules the timer on a new owner.
- Past-due shared debounce runs immediately after recovery.
- Active sync lock causes shared debounce to reschedule, not run.
- Pending auto-sync covered by shared debounce does not schedule duplicate per-tab recovery.

### Running sync recovery

- Closing a running background worker leaves lock valid and blocks immediate recovery.
- After lock expiry, pending dirty state schedules recovery.
- If the old worker actually completed, recovery becomes no-op or clears pending as already synced.
- If the old worker failed before writing, recovery performs the needed push.
- If remote changed independently during the gap, recovery goes to conflict or safe pull/push decision.

## Open Questions — Resolved (2026-05-26 grill session)

- **Should the navbar keep showing running while title suppresses it?** → Yes. Navbar keeps lock-freshness display; title requires verified live runner. Two strictness levels per display context.
- **Should title use a stricter display profile for all active states, or only for running?** → Running only. Pending also suppressed in title. Title shows: result phases + verified live-runner running.
- **Should recovery expose a non-title navbar pending reason such as `等待恢复同步`?** → No. Diagnostic panel shows full state chain; navbar shows simplified running/pending/results.
- **Do we want a stored live-runner heartbeat separate from sync locks?** → No. Suppressing cross-tab running title (via lock owner verification) is sufficient.

> See full resolutions: [sync-title-status-grill-findings.md](./sync-title-status-grill-findings.md#open-questions--resolved)

## Implementation Summary (updated 2026-05-26)

1. **Title handoff for Result Phases** — implemented through explicit owner lease handoff when the previous owner is gone, stale, or no longer present.
2. **Running title requires Live Runner** — implemented with `shouldSuppressAutoSyncIndicatorRunningForTitle()` and `getAutoSyncIndicatorLiveRunnerOwnerIdForTitle()`.
3. **Live Runner owner selection** — implemented by storing `syncOwnerId` in title presence and matching it against `displayLiveRunnerOwnerId`.
4. **Stale running fallback guard** — implemented for `ttlProfile: "title"` when `lastResolvedTimestamp < state.timestamp`.
5. **Scheduler recovery** — unchanged; existing tests cover it.
6. **Running sync recovery** — unchanged and conservative; recovery waits for lock expiry.
7. **Remote write fencing** — deferred. Not needed for current scope; risk is low.

> Full implementation plan: [sync-title-status-grill-findings.md](./sync-title-status-grill-findings.md#implementation-decisions)

The key principle is:

> Results can move between tabs. Running work cannot. Pending work can be recovered.
