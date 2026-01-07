# Windows Crash Investigation Timeline

## Executive Summary

**Initial Hypothesis**: Bun.spawn/ShellInterpreter GC bug causing crashes on Windows  
**Actual Root Cause**: Conflict between oh-my-opencode's session-notification and external notification plugins (specifically `@mohak34/opencode-notifier`)

**Evidence**: User removed `@mohak34/opencode-notifier` plugin → crashes stopped immediately. The release version of oh-my-opencode (with original Bun.spawn code) works fine when used alone.

---

## Timeline

### Phase 1: Initial Crash Reports (Early January 2026)

**Symptoms:**
- Windows users experiencing crashes after extended oh-my-opencode usage
- Stack traces pointed to Bun's ShellInterpreter finalizer:
  ```
  Segmentation fault at address 0x337081E00E0
  - interpreter.zig:1239: deinitFromFinalizer
  - ZigGeneratedClasses.zig:19925: ShellInterpreterClass__finalize
  ```

**Initial Analysis:**
- Similar to known Bun issues: oven-sh/bun#23177, oven-sh/bun#24368
- Focus on `ctx.$` (Bun shell template literals) in session-notification.ts

### Phase 2: PR #543 - Wrong Fix Merged (January 6, 2026)

**PR**: [#543 - fix(session-notification): avoid Bun shell GC crash on Windows](https://github.com/code-yeongyu/oh-my-opencode/pull/543)

**Changes Made:**
- Replaced `ctx.$` with `node:child_process.spawn` in `session-notification.ts`
- Updated tests to mock spawn instead of ctx.$

**Assumption**: The ShellInterpreter GC bug was causing crashes when notification commands were executed.

**Status**: ❌ MERGED (reverted in this PR)

### Phase 3: Continued Investigation - Debug Tracing (January 6-7, 2026)

Crashes continued after PR #543. Added debug tracing system (PR #571) to capture what happens before crashes.

**PR #571**: [feat(debug): add comprehensive crash tracing system](https://github.com/code-yeongyu/oh-my-opencode/pull/571)

Tracing revealed LSP ENOENT errors, leading to:

**PR #572**: [fix(lsp): add resilient handling for missing LSP server binaries](https://github.com/code-yeongyu/oh-my-opencode/pull/572)

### Phase 4: More Bun.spawn Changes (January 7, 2026) - WRONG PATH

Based on the assumption that Bun.spawn was the issue, additional files were modified locally:
- `src/hooks/session-notification-utils.ts`
- `src/hooks/comment-checker/cli.ts`
- `src/hooks/comment-checker/downloader.ts`
- `src/hooks/interactive-bash-session/index.ts`

**Status**: ❌ REVERTED (never committed)

### Phase 5: Root Cause Discovery (January 7, 2026)

**Critical Observation by User:**
> "I removed `@mohak34/opencode-notifier` and crashes stopped. The release version with Bun.spawn works perfectly fine."

**Key Evidence:**
1. Removing ONLY the notifier plugin fixed crashes
2. Release version (before PR #543) works fine for user and most others
3. No widespread complaints from other users about crashes
4. PR #543 was based on superficial pattern matching with Bun issues

---

## The Real Root Cause: Notification Plugin Conflict

### Two Plugins, Same Event

Both plugins listen to `session.idle` and send notifications:

| Aspect | oh-my-opencode | opencode-notifier |
|--------|---------------|-------------------|
| **Event** | `session.idle` | `session.idle` |
| **Delay** | 1.5s confirmation delay | Immediate |
| **Windows Notification** | PowerShell + Windows.UI.Notifications API | `node-notifier` → WindowsToaster → SnoreToast.exe |
| **Sound** | PowerShell Media.SoundPlayer | PowerShell Media.SoundPlayer |
| **Process spawning** | `ctx.$` (Bun shell) | `node:child_process` |

### Conflict Points

1. **Different notification systems fighting**:
   - oh-my-opencode: Direct PowerShell → Windows.UI.Notifications
   - opencode-notifier: SnoreToast.exe binary via node-notifier

2. **Same app identity**: Both register with "OpenCode" as the toast notifier app

3. **Concurrent execution**: Both trigger within milliseconds of each other on `session.idle`

4. **Resource contention**: Windows Toast API may not handle concurrent registrations gracefully

### Why It Wasn't Bun.spawn

- Both plugins use different spawning methods - this didn't matter
- Release version works fine when used alone
- Most users don't have this issue (most don't use both plugins)
- The stack trace pointed to ShellInterpreter, but correlation ≠ causation

---

## The Fix

### What This PR Does

1. **Reverts PR #543**: Restores original `ctx.$` usage (it was never the problem)

2. **Adds conflict detection**: 
   - Scans `opencode.json` for known notification plugins
   - Known plugins: `opencode-notifier`, `@mohak34/opencode-notifier`

3. **Auto-disables on conflict**:
   - When external notifier detected, skips creating session-notification hook
   - Logs clear warning explaining why

4. **Config override**:
   ```json
   {
     "notification": {
       "force_enable": true
     }
   }
   ```
   Users can force-enable oh-my-opencode's notification if they want.

---

## Lessons Learned

1. **Correlation ≠ Causation**: Stack traces can be misleading; investigate root cause thoroughly
2. **Test with user's exact environment**: The crash only happened with specific plugin combination
3. **Challenge assumptions**: "Bun.spawn is buggy" was accepted too quickly without verifying
4. **Evidence-based debugging**: User's discovery (removing notifier = no crash) was the key evidence

---

## Related Links

- PR #543 (merged, reverted in this PR): https://github.com/code-yeongyu/oh-my-opencode/pull/543
- PR #571 (open): https://github.com/code-yeongyu/oh-my-opencode/pull/571
- PR #572 (open): https://github.com/code-yeongyu/oh-my-opencode/pull/572
- opencode-notifier: https://github.com/mohak34/opencode-notifier
- Bun issues referenced (not actually the cause):
  - https://github.com/oven-sh/bun/issues/23177
  - https://github.com/oven-sh/bun/issues/24368
