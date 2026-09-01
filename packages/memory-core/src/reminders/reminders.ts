/**
 * Memory git status reminders — pure generator with condition-key dedupe.
 *
 * Ported semantics from letta reminders/memory-git-sync.ts:16-100:
 * dirty -> 'MEMORY COMMIT NEEDED' (lists paths + commit instruction),
 * conflict -> 'MEMORY GIT CONFLICT' (resolution guidance),
 * push_failed -> 'MEMORY SYNC FAILED' (retry text with reason).
 *
 * Dedupe: a RemindersState tracks emitted condition keys; the same condition
 * is NOT re-emitted until it clears. Clearing + re-triggering re-emits.
 * Exact letta wording is NOT required — semantic parity + stable machine
 * keys (reminder.kind) are. Texts are terse, no emojis.
 *
 * Priority (when multiple conditions coexist): conflict > push_failed > dirty.
 * Only the single highest-priority reminder is emitted per call; lower-priority
 * conditions surface after the higher one clears.
 */

/** Conflict operation kind derived from git state. */
export type ConflictState = "none" | "merge" | "rebase" | "unmerged";

/** Reason for a failed push, if any. */
export interface PushFailure {
  readonly reason: string;
}

/**
 * Immutable snapshot of repo status. The generator is pure over this input;
 * callers obtain it from git porcelain + .git inspection (see letta
 * memory-git.ts getMemoryConflictSummary / getMemoryAheadBehind).
 */
export interface RepoStatusSnapshot {
  /** Paths reported dirty by `git status --porcelain` (post-trim). */
  readonly dirtyPaths: readonly string[];
  /** Active conflict operation, or 'none'. */
  readonly conflictState: ConflictState;
  /** Commits ahead of upstream (0 when no upstream / not ahead). */
  readonly aheadCount: number;
  /** Present when the last remote push failed. */
  readonly lastPushFailed?: PushFailure;
}

/** Stable machine key identifying a reminder category. */
export type ReminderKind = "dirty" | "conflict" | "push_failed";

/** A single emitted reminder. */
export interface Reminder {
  readonly kind: ReminderKind;
  readonly text: string;
}

/**
 * Mutable dedupe state. Tracks the condition key currently considered
 * "emitted" so it is not re-emitted until it clears.
 */
export interface RemindersState {
  /** The last emitted condition key, or null when nothing is active. */
  emittedKey: string | null;
}

/** Factory: create a fresh reminders state with nothing emitted. */
export function createRemindersState(): RemindersState {
  return { emittedKey: null };
}

/**
 * Determine the active reminder kind for a snapshot, or null when clean.
 * Priority: conflict > push_failed > dirty.
 */
export function reminderKindFor(
  snapshot: RepoStatusSnapshot,
): ReminderKind | null {
  if (snapshot.conflictState !== "none") return "conflict";
  if (snapshot.lastPushFailed !== undefined) return "push_failed";
  if (snapshot.dirtyPaths.length > 0) return "dirty";
  return null;
}

/**
 * Build a stable condition key for dedupe. Two snapshots with the same key
 * are considered the "same condition" and the second is suppressed.
 *
 * - dirty: "dirty" (path list is NOT part of the key — any dirty state
 *   is the same condition; the caller sees updated paths only after a
 *   clear/re-trigger cycle).
 * - conflict: `conflict:<state>` (merge vs rebase vs unmerged differ).
 * - push_failed: `push_failed:<reason>` (a new reason is a new condition).
 * - clean: null (clears any active condition).
 */
function conditionKeyFor(
  snapshot: RepoStatusSnapshot,
  kind: ReminderKind | null,
): string | null {
  if (kind === null) return null;
  switch (kind) {
    case "dirty":
      return "dirty";
    case "conflict":
      return `conflict:${snapshot.conflictState}`;
    case "push_failed":
      return `push_failed:${snapshot.lastPushFailed?.reason ?? ""}`;
  }
}

/** Render the dirty-state reminder text. */
function renderDirtyReminder(snapshot: RepoStatusSnapshot): string {
  const paths = snapshot.dirtyPaths;
  const listing = paths.slice(0, 20).join("\n  - ") + (
    paths.length > 20 ? `\n  - ...and ${paths.length - 20} more` : ""
  );
  return [
    "MEMORY COMMIT NEEDED: The memory repository has uncommitted changes.",
    "",
    `Uncommitted path(s):`,
    `  - ${listing}`,
    "",
    "Commit these memory changes when appropriate. Do not run `git push` " +
      "for MemFS sync; the harness pushes clean committed memory changes " +
      "automatically for remote MemFS agents after turns.",
  ].join("\n");
}

/** Render the conflict-state reminder text with resolution guidance. */
function renderConflictReminder(snapshot: RepoStatusSnapshot): string {
  const op = snapshot.conflictState;
  const opLabel =
    op === "merge"
      ? "merge in progress"
      : op === "rebase"
        ? "rebase in progress"
        : "unmerged files";
  const unmergedPaths = snapshot.dirtyPaths;
  const pathsLine = unmergedPaths.length > 0
    ? `\n\nConflicted file(s):\n  - ${unmergedPaths.slice(0, 20).join("\n  - ")}${unmergedPaths.length > 20 ? `\n  - ...and ${unmergedPaths.length - 20} more` : ""}`
    : "";
  return [
    "MEMORY GIT CONFLICT: The memory repository needs manual conflict resolution.",
    "",
    `Status: ${opLabel}.`,
    pathsLine,
    "",
    "Resolve the conflicts in the memory repository, stage the resolved " +
      "files, and complete the " +
      (op === "rebase" ? "rebase" : "merge") +
      ". The harness will retry remote push after a future turn when the " +
      "repo is clean.",
  ].join("\n");
}

/** Render the push-failed reminder text including the failure reason. */
function renderPushFailedReminder(snapshot: RepoStatusSnapshot): string {
  const reason = snapshot.lastPushFailed?.reason ?? "unknown";
  const ahead = snapshot.aheadCount;
  const aheadLine = ahead > 0
    ? `\nLocal commits ahead of remote: ${ahead}.`
    : "";
  return [
    "MEMORY SYNC FAILED: The harness could not push pending memory commits.",
    "",
    `Reason: ${reason}.${aheadLine}`,
    "",
    "Inspect the memory repository and resolve any local git issue. The " +
      "harness will retry remote push after a future turn when the repo is " +
      "clean.",
  ].join("\n");
}

function renderReminder(
  snapshot: RepoStatusSnapshot,
  kind: ReminderKind,
): string {
  switch (kind) {
    case "dirty":
      return renderDirtyReminder(snapshot);
    case "conflict":
      return renderConflictReminder(snapshot);
    case "push_failed":
      return renderPushFailedReminder(snapshot);
  }
}

/**
 * Generate reminders for a snapshot, applying condition-key dedupe against
 * the provided state. Mutates `state.emittedKey` to track what has been
 * emitted so the same condition is not re-emitted until it clears.
 *
 * Returns the list of newly emitted reminders (0 or 1). A "clear" (clean
 * snapshot) produces no reminder but resets the state so the next trigger
 * re-emits.
 */
export function generateReminders(
  state: RemindersState,
  snapshot: RepoStatusSnapshot,
): readonly Reminder[] {
  const kind = reminderKindFor(snapshot);
  const key = conditionKeyFor(snapshot, kind);

  // Clean snapshot: clear the active condition so the next trigger emits.
  if (kind === null) {
    state.emittedKey = null;
    return [];
  }

  // Same condition already emitted: suppress.
  if (state.emittedKey === key) {
    return [];
  }

  // New or re-triggered condition: emit and record.
  // kind is non-null here because kind === null returned above.
  state.emittedKey = key;
  const text = renderReminder(snapshot, kind);
  return [{ kind, text }];
}
