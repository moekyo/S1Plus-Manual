# Cross-Device Auto-Pull Implementation Plan

## Objective
Make device B receive newer remote data automatically in more real-world cases, without forcing users to manually pull in the normal “device A pushed successfully, device B later resumes usage” workflow.

## 1. Problem Statement

The current sync engine already handles **automatic push** well, but **automatic pull** only runs during startup-style checks. If device B remains open, resumes from background, or has already completed its one daily check, it does not actively detect that remote data changed on device A. The existing `pageshow` and `visibilitychange` hooks only recover pending local push tasks, not remote freshness.

Result: remote data is fresh, but device B stays stale until manual sync or another startup/load check.

## 2. Product Goal

Users should get the latest data on device B with minimal friction in these common cases:

1. Device A changes data and pushes successfully.
2. Device B later:
   - switches back to the tab,
   - restores from bfcache,
   - or stays open for a long time.
3. If device B has no meaningful local edits, it should update automatically.
4. If device B has local edits or a genuine conflict, the script should protect the user and fall back to the current manual-resolution model.

## 3. Proposed Solution Overview

Add a new **remote freshness probe layer** that sits before the existing sync engine:

1. On selected trigger points, perform a **metadata-only** probe using `fetchRemoteData({ metadataOnly: true })`.
2. Compare the new remote `updated_at` with the last known synced/probed remote timestamp.
3. If remote metadata is unchanged, do nothing.
4. If remote metadata changed, schedule a normal safe sync check through the existing startup-style path.
5. Let `performAutoSync()` keep ownership of the actual decision:
   - `pull`
   - `force_pull`
   - `skip_push_on_startup`
   - `conflict`
   - `merged_read_progress`

This keeps one source of truth for correctness while adding the missing trigger mechanism.

Important refinement after edge-case review:

- **Foreground-only checks are not sufficient on their own.**
- The final design should be **foreground checks + low-frequency visible-page polling + cross-tab shared throttling**.

## 4. New Behavior Model

### 4.1 New concept: Remote freshness probe

Introduce a lightweight “probe” that only fetches Gist metadata and answers one question:

> “Has the remote snapshot changed since this device last confirmed it?”

The probe must not import data directly.

### 4.2 Trigger points

Recommended trigger points:

1. `visibilitychange` when `document.visibilityState === "visible"`
2. `pageshow` including bfcache restore
3. Low-frequency timer while page stays visible

Recommended final behavior:

1. `visibilitychange` + `pageshow` handle “user came back to device B”
2. Visible-page polling every 3-5 minutes handles “device B stayed on screen while the user was away”

Reason:
- `focus` alone is noisy and inconsistent.
- `visibilitychange` and `pageshow` map well to “the user returned to device B”.
- Visible-page polling closes the always-visible blind spot.
- Polling must remain metadata-only and low-frequency.

### 4.3 Edge-case behavior expectations

#### Case: page remains visible for a long time

- Foreground checks will not fire because no `hidden -> visible` transition occurs.
- The visible-page timer becomes the only way to notice remote changes.
- Therefore the polling layer is not just a nice-to-have; it is required if we want the feature to fully solve the original cross-device problem.

#### Case: many tabs, rapid switching

- Switching across multiple open tabs must not cause every tab to probe independently.
- The design must share probe freshness state across tabs.
- The expected outcome is:
  - at most one metadata probe during the cooldown window across the browser profile
  - at most one full sync check once remote change is detected

## 5. Settings Design

Expose one mutually exclusive automatic-check control in the sync settings UI:

- `自动检查云端更新`
- options:
  - `关闭`
  - `每次加载`
  - `回到前台`

Internal mapping:

- `关闭`
  - `syncPerLoadCheckEnabled = false`
  - `syncCheckOnReturnToForeground = false`
- `每次加载`
  - `syncPerLoadCheckEnabled = true`
  - `syncCheckOnReturnToForeground = false`
- `回到前台`
  - `syncPerLoadCheckEnabled = false`
  - `syncCheckOnReturnToForeground = true`

Recommended explanation:

- `回到前台` mode covers both return-to-foreground / bfcache checks and the later low-frequency visible-page polling path.

Why a separate setting:
- This is neither “daily first load” nor “per page load”.
- It is behaviorally different from background auto-push.
- Users may want startup checks but not foreground checks, or the reverse.

Suggested default:
- `true` for new installs after the feature ships
- For existing users, conservative migration:
  - if remote sync is enabled and auto sync is enabled, default to `true`
  - otherwise `false`

If you want a safer rollout:
- default `false` for migrated users
- default `true` only for brand-new setups

## 6. State Additions

Add lightweight persisted state:

### 6.1 `s1p_last_remote_probe_info`

Suggested shape:

```json
{
  "lastObservedRemoteUpdatedAt": "2026-04-11T12:34:56Z",
  "lastObservedAt": 1760000000000,
  "lastSyncedRemoteUpdatedAt": "2026-04-11T12:30:00Z"
}
```

Purpose:
- Remember the last remote metadata seen by this device.
- Distinguish “remote was observed” from “remote was successfully reconciled”.
- Avoid repeated full sync checks when the remote has not changed.

### 6.2 Shared cross-tab cooldown

Recommended additional field shape:

```json
{
  "lastObservedRemoteUpdatedAt": "2026-04-11T12:34:56Z",
  "lastObservedAt": 1760000000000,
  "checkedBy": "tab_or_owner_id"
}
```

Purpose:
- Prevent rapid tab switching from issuing repeated metadata probes.
- Let every tab see that another tab has already checked recently.

Recommended cooldown:
- 30-60 seconds shared across tabs

### 6.3 In-memory cooldown

Suggested runtime variables:

- `lastForegroundProbeAt`
- `foregroundProbeInFlight`

Purpose:
- Smooth out repeated visibility flaps within a single tab.
- Prevent duplicate work before persisted shared state settles.

Recommended cooldown:
- 10-15 seconds minimum between foreground probes per tab

### 6.4 Optional lightweight probe lock

Suggested key:

- `s1p_remote_probe_lock`

Purpose:
- Ensure only one tab performs the metadata probe at a time during heavy tab switching.
- This lock can be much shorter and simpler than the main sync locks.

Recommended TTL:
- 5-10 seconds

### 6.5 Activity-aware polling state

Suggested runtime variables:

- `lastUserInteractionAt`
- `visibleProbeTimer`
- `currentVisibleProbeIntervalMs`

Purpose:
- Slow down or suspend visible-page polling when the page is visible but the user is clearly inactive.

## 7. Execution Flow

### 7.1 Foreground probe flow

New function:

- `checkRemoteFreshnessOnForeground(reason = "visibility")`

Flow:

1. Exit early if:
   - remote sync disabled
   - credentials incomplete
   - foreground-check setting disabled
   - conflict pause active
   - circuit breaker open
   - another sync mode lock is active
   - shared probe cooldown not elapsed
   - local in-memory cooldown not elapsed
   - probe lock cannot be acquired
2. Call `fetchRemoteData({ metadataOnly: true })`
3. Read `meta.updatedAt`
4. Compare against:
   - `getSyncBaselineState()?.remoteUpdatedAt`
   - and/or `s1p_last_remote_probe_info.lastObservedRemoteUpdatedAt`
5. If unchanged:
   - update probe timestamp
   - stop
6. If changed:
   - persist the newly observed `updatedAt`
   - schedule a real sync check using startup lock path

### 7.1.1 Visible-page polling flow

New scheduler:

- `scheduleVisibleRemoteFreshnessPolling()`

Rules:

1. Only active when:
   - page is visible
   - remote sync enabled
   - foreground/visible freshness feature enabled
2. Probe interval:
   - recommended default 180-300 seconds while user is active
   - recommended degraded interval 600-900 seconds after long inactivity
3. Polling probe reuses the same metadata-only function and the same shared cooldown / lock rules
4. If page becomes hidden:
   - stop timer
5. If page becomes visible again:
   - run an immediate guarded foreground probe
   - then restart timer
6. If the user has been inactive for a long time:
   - reduce polling frequency or pause polling entirely

### 7.2 Real sync check after a positive probe

Do not create a second decision engine.
Instead, call something like:

- `requestForegroundRemoteCheck("remote_probe_changed")`

That function should:

1. Acquire startup sync lock if possible
2. Call `performAutoSync(true, SYNC_LOCK_MODE_STARTUP)`
3. Reuse existing result handling and messaging with a small copy split for foreground-originated checks

This preserves current safety semantics.

## 8. Decision Rules

The feature should follow these rules:

### Case A: Remote changed, local unchanged
- Auto-pull
- If current page state depends on imported data, refresh behavior should depend on page type:
  - list / lightweight pages: refresh immediately
  - thread pages: prefer delayed refresh, idle refresh, or user prompt
  - settings modal with dirty edits: do not auto-refresh

### Case B: Remote changed, only reading progress differs on both sides
- Allow existing read-progress auto-merge path
- No new special case needed

### Case C: Remote changed, local also changed meaningfully
- Do not silent-pull
- Reuse current conflict / local-newer guard
- Show persistent guidance to use manual sync

### Case D: Probe succeeds, metadata changed, but full sync later finds no content difference
- Treat as normal no-op
- This can happen if timestamps drift or another device rewrote equivalent content

## 9. UI/UX Plan

### 9.1 New user-facing copy

Keep foreground-probe copy low-noise.

Recommended messages:

- Success pull:
  - `检测到云端有更新，已自动同步，正在刷新页面...`
- Safe no-op:
  - no toast, or only diagnostics log
- Local changes block pull:
  - `检测到云端有更新，但本地也有未处理改动。为保护数据，已暂停自动拉取，请手动同步。`
- Conflict:
  - `检测到云端与本地可能同时有变更，已暂停自动处理，请手动同步。`

### 9.2 Indicator behavior

Reuse current auto-sync indicator.

Suggested additions:
- pending reason: `foreground_probe`
- running reason: `foreground_probe_sync`

No need for a new icon state.

### 9.3 Diagnostics

Extend sync diagnostics with optional fields:

- `lastProbeTimestamp`
- `lastProbeRemoteUpdatedAt`
- `lastSyncedRemoteUpdatedAt`
- `lastProbeResult` (`unchanged`, `changed`, `throttled`, `skipped_disabled`, `skipped_conflict_pause`, etc.)
- `lastProbeTriggeredSync` (`true/false`)
- `lastProbeTriggeredSyncResult`

This will greatly help future debugging.

### 9.4 Refresh policy

Recommended refresh rules:

1. If the current page is a lightweight forum list page:
   - allow immediate reload after successful auto-pull
2. If the current page is a thread reading page:
   - prefer delayed reload or a non-blocking “click to refresh” banner
3. If settings modal is open and dirty:
   - never auto-reload
   - show a protective notice instead

## 10. Rate Limit and Performance Strategy

This is the main engineering risk, so control it explicitly.

### 10.1 Metadata only first
- Never do full content fetch on every foreground event
- Probe metadata only

### 10.2 Shared cooldown
- Minimum 30-60 seconds between metadata probes across tabs

### 10.3 Local cooldown
- Minimum 10-15 seconds between metadata probes inside one tab

### 10.4 Single-flight
- Only one foreground probe in flight per tab

### 10.5 Probe lock
- Optional but recommended under aggressive multi-tab usage
- Ensures rapid tab switching does not create metadata request bursts

### 10.6 Lock-aware skip
- If startup/manual/background sync already holds the global lock, skip the probe-triggered check

### 10.7 Visible polling
- Poll only when page is visible
- Suggested interval: 180-300 seconds
- Polling reuses metadata-only probe path, never full fetch directly

### 10.8 Activity-aware backoff
- If no user interaction is detected for a long window, degrade polling frequency to 600-900 seconds
- If the page remains visible but fully idle for a very long time, polling may be paused
- Any new interaction should restore the shorter polling interval

## 11. Migration Plan

### Phase 1: Infrastructure
- Add new setting
- Add new probe state storage
- Add shared probe cooldown state
- Add optional probe lock
- Add activity-aware polling state
- Add diagnostics fields

### Phase 2: Trigger integration
- Hook probe into `pageshow` and `visibilitychange`
- Add shared/local cooldown and single-flight guards

### Phase 3: Visible-page polling
- Add low-frequency polling while page remains visible
- Reuse the same guarded metadata-only probe path

### Phase 4: Result handling
- Reuse startup-style sync result pipeline
- Split copy for foreground-triggered syncs where necessary

### Phase 5: Refresh policy hardening
- Add page-type-aware refresh handling
- Protect settings-modal dirty state from automatic reload

## 12. Code Change Map

Expected touch points in `S1Plus.js`:

1. `defaultSettings`
   - add `syncCheckOnReturnToForeground`

2. `buildNormalizedSettings`
   - normalize and migrate the new setting

3. Settings modal (`buildSyncSettingsTabHtml`, modal hydration, save path)
   - render new toggle
   - load/save it

4. Probe state helpers
   - get/set remote probe info
   - shared cooldown helpers
   - probe lock helpers
   - visible polling scheduler
   - user-activity tracker

5. Event hooks
   - extend existing `pageshow` / `visibilitychange` handling
   - add lightweight user-activity sampling hooks

6. New orchestration function
   - `checkRemoteFreshnessOnForeground(...)`
   - `requestForegroundRemoteSyncCheck(...)`

7. Diagnostics / indicator helpers
   - optional but strongly recommended

## 13. Pseudocode

```javascript
async function checkRemoteFreshnessOnForeground(reason) {
  if (!shouldRunForegroundRemoteProbe()) return;
  if (foregroundProbeInFlight) return;
  if (!acquireRemoteProbeLock()) return;

  foregroundProbeInFlight = true;
  try {
    const { meta } = await fetchRemoteData({ metadataOnly: true });
    const remoteUpdatedAt = meta.updatedAt || "";
    const baselineRemoteUpdatedAt = getSyncBaselineState()?.remoteUpdatedAt || "";
    const lastProbeInfo = getLastRemoteProbeInfo();

    saveLastRemoteProbeInfo({
      lastObservedRemoteUpdatedAt: remoteUpdatedAt,
      lastObservedAt: Date.now(),
    });

    const lastKnownRemoteUpdatedAt =
      baselineRemoteUpdatedAt ||
      lastProbeInfo.lastObservedRemoteUpdatedAt ||
      "";

    if (!remoteUpdatedAt || remoteUpdatedAt === lastKnownRemoteUpdatedAt) {
      recordProbeResult("unchanged");
      return;
    }

    recordProbeResult("changed");
    requestForegroundRemoteSyncCheck(reason);
  } catch (error) {
    recordProbeResult("failure", error.message);
  } finally {
    foregroundProbeInFlight = false;
    releaseRemoteProbeLock();
  }
}
```

## 14. Testing Plan

### Functional scenarios

1. Device A changes settings, pushes successfully, device B returns to visible tab
   - expected: auto-pull on B

2. Device A advances reading progress, device B returns
   - expected: auto-pull or read-progress merge

3. Device B has unsynced local settings change, then remote changes
   - expected: no silent overwrite; manual sync required

4. Device B stays visible for 10+ minutes while device A updates remote
   - expected: visible-page polling detects remote update within one poll interval

5. Multiple tabs switch rapidly within the cooldown window
   - expected: shared cooldown suppresses repeated metadata probes

6. Multiple tabs detect remote change around the same time
   - expected: at most one tab reaches full sync execution path

7. Conflict pause active
   - expected: foreground probe skips

8. Circuit breaker active
   - expected: foreground probe skips

9. Remote metadata changes but content is effectively same
   - expected: no harmful behavior; possibly no-op sync result

10. Settings modal open with unsaved edits while remote update is detected
   - expected: no automatic reload; protective notice only

11. Thread page stays visible and user is inactive for a long time
   - expected: polling slows down or pauses according to activity-aware backoff

### Regression scenarios

1. Existing daily-first-load behavior remains unchanged
2. Existing per-page-load check remains unchanged
3. Existing pending local auto-push recovery remains unchanged
4. Manual sync flow remains unchanged

## 15. Recommended Rollout Order

Recommended implementation order:

1. Add setting + state helpers
2. Add foreground metadata probe
3. Add visible-page polling on the same probe path
4. Reuse startup sync execution path after positive probe
5. Add diagnostics fields
6. Add page-type-aware refresh policy and dirty-modal protection

## 16. Recommendation

The best first implementation is:

1. Add **foreground metadata probe** on `visibilitychange` and `pageshow`
2. Add **low-frequency visible-page polling** to cover always-visible pages
3. Add **shared cross-tab cooldown** so rapid switching does not create request bursts
4. Add **observed vs synced remote state separation** to avoid state confusion
5. Add **activity-aware polling backoff** so visible-but-idle pages do not over-poll
6. Keep full sync decisions inside existing `performAutoSync()`
7. Add a dedicated user setting for this behavior

## 17. Known Risks and Chosen Mitigations

### Risk: Metadata changes without meaningful content change
- Mitigation:
  - treat probe as a hint, not a direct import signal
  - let `performAutoSync()` make the final decision

### Risk: Rapid tab switching causes request bursts
- Mitigation:
  - shared cooldown
  - optional probe lock
  - existing global sync lock for the real sync phase

### Risk: Page reload interrupts reading
- Mitigation:
  - page-type-aware refresh policy
  - softer handling on thread pages

### Risk: Visible unattended page accumulates API calls
- Mitigation:
  - metadata-only polling
  - activity-aware backoff

### Risk: Unsaved UI edits get disrupted
- Mitigation:
  - dirty-modal protection
  - warning instead of auto-reload

This gives the biggest UX win for the original device-A/device-B problem while still controlling API cost, multi-tab churn, and overwrite risk.
