# S1 Plus — Sync, Status & Reading Progress

Sync execution, status display, and confirmed reading progress for the S1 Plus Tampermonkey userscript. Covers how sync runs, how state is displayed across tabs, how ownership transfers between tabs on close, and when a thread visit is allowed to advance reading progress.

## Language

**Sync Indicator State**:
The shared persisted state (`s1p_auto_sync_indicator_state`) that records the current sync phase, the last resolved result, and a per-cycle token. Consumers do not interpret this record directly; they read it through the Sync Indicator State Projection.
_Avoid_: display state, UI state

**Sync Indicator State Projection**:
The deep module interface `readSyncIndicatorStateProjection({ surface })`. It combines Sync Indicator State, Pending Dirty, fresh Sync Locks, Live Runner evidence, Result Phase, conflict/circuit gates, and the existing surface TTL into one projected fact for either `navbar` or `title`. Navbar and Title Owner share the same priority implementation; surface-specific policy stays inside the projection.
_Avoid_: title state parser, navbar state parser

**Sync Lock**:
A mutual-exclusion guard stored in GM storage that prevents multiple tabs from executing sync simultaneously. Each lock has an owner (per-tab random ID), a timestamp refreshed by heartbeat, and a TTL. Locks exist per mode (background, startup, manual) plus a global lock.
_Avoid_: mutex, semaphore

**Running Sync**:
An active sync worker — a Promise executing in a specific tab's JS context. Running sync is NOT transferable between tabs. If the worker's tab closes, the Promise is lost.
_Avoid_: in-flight sync, active sync (ambiguous with lock state)

**Title Owner**:
The single background S1 tab elected to display sync status in the browser tab title (`document.title`). Selection favors the most recently active background tab for Result Phases, and Result Phase ownership can hand off when the previous owner closes or its presence/lease becomes invalid. Running title display is stricter: the Live Runner takes precedence over recency, and non-runner tabs must not display running. Title display only activates when all S1 tabs are in the background.
_Avoid_: title tab, display tab

**Scheduler Owner**:
The tab responsible for managing the shared debounce timer that triggers background sync pushes. Ownership includes a lease with expiry; other tabs can recover ownership when the lease expires.
_Avoid_: timer owner, debounce owner

**Pending Dirty**:
Local changes (primarily read progress updates) that have been recorded but not yet pushed to the remote Gist. Stored in `s1p_pending_auto_sync_request` and the shared debounce state.
_Avoid_: unsaved changes, local delta

**Read Progress**:
The per-thread record of the furthest page and floor the reader has confirmed. It advances monotonically so an older observation cannot move a thread backward.
_Avoid_: scroll position, last seen post

**Reading Progress Session**:
The bounded visit to one thread page in which visible posts and foreground reader activity may confirm an advance to Read Progress. A passively opened or hidden-starting visit remains unconfirmed until it reaches the foreground.
_Avoid_: tracker state, observer session

**Core Business Data**:
The seven logical data kinds synchronized as forum business state: Blocked Threads, Blocked Users, Blocked Posts, User Tags, Bookmarked Replies, Title Filter Rules, and Read Progress. Their storage keys, sync identities, normalization, cache state, cross-tab signals, and refresh intents belong to one private kind catalog.
_Avoid_: GM data map, sync data keys

**Core Business Data Interface**:
The deep module interface `s1pCoreBusinessData`. Feature and sync callers use `read()`, `write()`, `projectForSync()`, `importFromSync()`, `syncFromStorage()`, and `bindCrossTab()` with logical kinds; they do not interpret storage keys, legacy identities, normalizers, or sync field names. The production GM adapter and in-memory test adapter share this interface.
_Avoid_: storage helper collection, data cache globals

**Image Viewer Interface**:
The frozen interface `s1pImageViewer`. External settings, modal, and debug callers observe only `readState()` and request the semantic actions `refreshDefaultTransform()` or `closeImmediately()`; mutable viewer phase flags and transition cleanup remain private to the viewer implementation.
_Avoid_: image viewer state object, viewer globals

**Settings Semantics**:
The per-setting meaning shared by direct settings changes, cross-tab refresh, and an open settings modal: refresh class, runtime effect intents, modal-tab projection, sync-form projection, and focused normalization. Canonical defaults remain in `defaultSettings`, while schema migration remains in `buildNormalizedSettings()`.
_Avoid_: settings path lists, modal wiring regex

**Settings Semantics Interface**:
The frozen interface `s1pSettingsSemantics`. Callers use `resolveChangedPaths()`, `projectSyncModal()`, `buildSyncSettingsPatch()`, and `normalizeImageSettings()`; the setting catalog, effect aggregation, and shared token-expiry normalization stay private. The bespoke settings-tab renderer and primary feature-toggle branches remain outside this interface.
_Avoid_: generic settings renderer, settings registry

**Result Phase**:
A completed sync outcome — success, failure, or conflict — that was explicitly committed by a resolved-state writer such as `finishAutoSyncIndicatorCycle` or `setAutoSyncIndicatorResolvedPhase`. Result phases are safe to display across tabs because they describe an already-completed action, not an in-progress one.
_Avoid_: final state, outcome

**Result Phase Policy**:
The deep module interface `s1pSyncResultPhasePolicy.handle(result, context)`. After Running Sync releases its mode and global Sync Locks, it turns the completed result into refresh, conflict-pause, retry, and notification intents. Background, daily startup, per-load, and foreground follow-up callers share this decision path; source-specific copy, modal content, and refresh adapters remain outside the module. A retry intent describes policy, while `retryResult.status` proves whether its adapter actually scheduled work; foreground consumers preserve retry state only for `scheduled` or `already_scheduled` results, while the background adapter reports explicit `scheduled`, `delegated`, or `blocked` outcomes.
_Avoid_: result switch, post-sync UI handler

**Sync System Façade**:
The final page-facing interface `s1pSyncSystem`. Page code uses `initialize()`, `recordLocalMutation()`, `handleLifecycle()`, `requestSync()`, and `readState()` to express sync intent without coordinating Sync Locks, Scheduler Owner leases, timers, generations, lifecycle support, Result Phase handling, or projection internals. `dispose()` is reserved for explicit host teardown such as tests or a future SPA remount; ordinary `pagehide` / `beforeunload` cleanup stays inside `handleLifecycle()` because the browser destroys the page context. The façade owns startup recovery ordering and routes semantic sync requests to the existing deep modules.
_Avoid_: sync manager, sync service, global sync helpers

**Ghost Running**:
A title display of `[同步中...]` that appears when a tab sees a fresh sync lock but no live tab is actually executing sync. Caused by a worker tab closing without releasing its lock. Maximum duration: 45 seconds (lock TTL).
_Avoid_: phantom sync, false running

**Live Runner**:
A tab that demonstrably owns an active sync lock (its `BACKGROUND_SYNC_OWNER_ID` matches the lock owner) AND has a running JS context. Only a Live Runner is credible evidence that sync is actually executing, and only the Live Runner may show a running title prefix.
_Avoid_: active worker, running tab (ambiguous with "tab that last showed running")

**Title Live Runner Mapping**:
For title display, the resolved Sync Indicator State may expose `displayLiveRunnerOwnerId`, and each title presence record carries `syncOwnerId`. The title runtime matches those values to pick the Live Runner tab for Running Phase. If no live presence record matches, the title goes idle instead of falling back to Result Phase or recency.
_Avoid_: live-runner heartbeat, runner election

## Relationships

- A **Sync Lock** is owned by exactly one tab (identified by per-tab random ID)
- A **Running Sync** holds a **Sync Lock** and renews it via heartbeat
- **Ghost Running** occurs when a **Sync Lock** exists but no **Live Runner** holds it
- The **Sync Indicator State Projection** derives the displayed phase from **Sync Indicator State**, **Sync Lock** freshness, **Pending Dirty**, and the last recorded **Result Phase**
- For the navbar, **Pending Dirty** takes precedence over a foreign background **Sync Lock**. Another tab's fresh background lock must not upgrade a pending local push into a running push animation; only the current tab as **Live Runner** may do that.
- The navbar and **Title Owner** both read the **Sync Indicator State Projection**; neither reinterprets locks, pending work, directions, or Result Phase TTL independently
- For **Running Sync**, the **Title Owner** must resolve to the **Live Runner** using the title live-runner mapping; ordinary recency-based ownership applies to **Result Phases**
- The **Scheduler Owner** manages the debounce timer independently from both **Sync Lock** and **Title Owner**
- **Result Phases** can transfer between tabs; **Running Sync** cannot; **Pending Dirty** can be recovered by a new **Scheduler Owner**
- The **Result Phase Policy** runs only after **Running Sync** releases its Sync Locks; callers consume its intents instead of switching on result status independently
- Page callers cross the **Sync System Façade**; Pending Dirty Scheduler, lifecycle adapter, Running Sync, Result Phase Policy, and Sync Indicator State Projection remain internal modules
- Sync and feature callers cross the **Core Business Data Interface**; only its private catalog maps logical kinds to storage and sync identities
- Settings and modal callers cross the **Image Viewer Interface**; they do not inspect or mutate viewer lifecycle flags
- Direct, cross-tab, and modal settings callers share the **Settings Semantics Interface** instead of maintaining path, effect, and form mappings independently
- A stale **Running Sync** title does not fall back to an older **Result Phase**; it stays idle until a resolved-state writer commits a new Result Phase or pending recovery produces one

## Example dialogue

> **Dev:** "When the title owner tab closes during a running sync, what should another background tab show in the title?"
> **Domain expert:** "Nothing — the tab should go idle. The old tab was the live runner, and we can't transfer a running Promise to a new tab. When the lock expires, the pending dirty state will trigger recovery, and if that produces a result phase, the title will show it then."
>
> **Dev:** "And if the title owner closes after a successful sync?"
> **Domain expert:** "Another background tab should pick up the success prefix. The result phase is already recorded and has a TTL — it's safe to display anywhere."

## Flagged ambiguities

- "sync running" was used to mean both "a fresh lock exists" and "a tab is actively executing sync" — resolved: **Running Sync** = active execution; **Sync Lock** freshness alone is insufficient evidence for title display.
