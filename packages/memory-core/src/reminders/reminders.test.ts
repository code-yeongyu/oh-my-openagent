import { describe, it, expect } from "bun:test";
import {
  createRemindersState,
  generateReminders,
  reminderKindFor,
  type RepoStatusSnapshot,
  type RemindersState,
  type Reminder,
} from "./reminders";

describe("reminders", () => {
  describe("#given a clean repo snapshot", () => {
    const snapshot: RepoStatusSnapshot = {
      dirtyPaths: [],
      conflictState: "none",
      aheadCount: 0,
    };

    it("#then generateReminders returns no reminders", () => {
      const state = createRemindersState();
      const reminders = generateReminders(state, snapshot);

      expect(reminders).toEqual([]);
    });

    it("#then reminderKindFor is null", () => {
      expect(reminderKindFor(snapshot)).toBeNull();
    });
  });

  describe("#given a dirty repo snapshot", () => {
    const snapshot: RepoStatusSnapshot = {
      dirtyPaths: ["system/notes.md", "reference/goals.md"],
      conflictState: "none",
      aheadCount: 0,
    };

    it("#then generateReminders emits a dirty reminder with COMMIT NEEDED text and paths", () => {
      const state = createRemindersState();
      const reminders = generateReminders(state, snapshot);

      expect(reminders).toHaveLength(1);
      const reminder = reminders[0]!;
      expect(reminder.kind).toBe("dirty");
      expect(reminder.text).toContain("MEMORY COMMIT NEEDED");
      expect(reminder.text).toContain("system/notes.md");
      expect(reminder.text).toContain("reference/goals.md");
    });

    it("#then re-generating with same snapshot does NOT re-emit (dedupe)", () => {
      const state = createRemindersState();
      const first = generateReminders(state, snapshot);
      expect(first).toHaveLength(1);

      const second = generateReminders(state, snapshot);
      expect(second).toEqual([]);
    });

    it("#then after clearing to clean, re-triggering emits again", () => {
      const state = createRemindersState();
      generateReminders(state, snapshot);
      // Clear
      generateReminders(state, {
        dirtyPaths: [],
        conflictState: "none",
        aheadCount: 0,
      });
      // Re-trigger
      const retriggered = generateReminders(state, snapshot);
      expect(retriggered).toHaveLength(1);
      expect(retriggered[0]!.kind).toBe("dirty");
    });
  });

  describe("#given a merge conflict snapshot", () => {
    const snapshot: RepoStatusSnapshot = {
      dirtyPaths: [],
      conflictState: "merge",
      aheadCount: 0,
    };

    it("#then generateReminders emits a conflict reminder with resolution guidance", () => {
      const state = createRemindersState();
      const reminders = generateReminders(state, snapshot);

      expect(reminders).toHaveLength(1);
      const reminder = reminders[0]!;
      expect(reminder.kind).toBe("conflict");
      expect(reminder.text).toContain("MEMORY GIT CONFLICT");
      expect(reminder.text).toContain("merge");
      expect(reminder.text).toContain("resolve");
    });

    it("#then dedupe prevents re-emission while conflict persists", () => {
      const state = createRemindersState();
      const first = generateReminders(state, snapshot);
      const second = generateReminders(state, snapshot);

      expect(first).toHaveLength(1);
      expect(second).toEqual([]);
    });
  });

  describe("#given a rebase conflict snapshot", () => {
    const snapshot: RepoStatusSnapshot = {
      dirtyPaths: [],
      conflictState: "rebase",
      aheadCount: 0,
    };

    it("#then the conflict reminder mentions rebase", () => {
      const state = createRemindersState();
      const reminders = generateReminders(state, snapshot);

      expect(reminders).toHaveLength(1);
      expect(reminders[0]!.text).toContain("rebase");
    });
  });

  describe("#given an unmerged-files conflict snapshot", () => {
    const snapshot: RepoStatusSnapshot = {
      dirtyPaths: ["system/conflict.md"],
      conflictState: "unmerged",
      aheadCount: 0,
    };

    it("#then the conflict reminder is emitted (conflict takes priority over dirty)", () => {
      const state = createRemindersState();
      const reminders = generateReminders(state, snapshot);

      expect(reminders).toHaveLength(1);
      expect(reminders[0]!.kind).toBe("conflict");
    });
  });

  describe("#given a push-failed snapshot", () => {
    const snapshot: RepoStatusSnapshot = {
      dirtyPaths: [],
      conflictState: "none",
      aheadCount: 2,
      lastPushFailed: { reason: "non-fast-forward" },
    };

    it("#then generateReminders emits a push_failed reminder with the reason", () => {
      const state = createRemindersState();
      const reminders = generateReminders(state, snapshot);

      expect(reminders).toHaveLength(1);
      const reminder = reminders[0]!;
      expect(reminder.kind).toBe("push_failed");
      expect(reminder.text).toContain("MEMORY SYNC FAILED");
      expect(reminder.text).toContain("non-fast-forward");
    });

    it("#then dedupe prevents re-emission while push remains failed", () => {
      const state = createRemindersState();
      const first = generateReminders(state, snapshot);
      const second = generateReminders(state, snapshot);

      expect(first).toHaveLength(1);
      expect(second).toEqual([]);
    });

    it("#then a different failure reason re-emits (condition-key includes reason)", () => {
      const state = createRemindersState();
      generateReminders(state, snapshot);

      const changed = generateReminders(state, {
        ...snapshot,
        lastPushFailed: { reason: "auth denied" },
      });
      expect(changed).toHaveLength(1);
      expect(changed[0]!.text).toContain("auth denied");
    });
  });

  describe("#given conflict + dirty + push_failed simultaneously", () => {
    const snapshot: RepoStatusSnapshot = {
      dirtyPaths: ["a.md", "b.md"],
      conflictState: "merge",
      aheadCount: 1,
      lastPushFailed: { reason: "network down" },
    };

    it("#then conflict takes priority over dirty (single highest-priority reminder)", () => {
      const state = createRemindersState();
      const reminders = generateReminders(state, snapshot);

      expect(reminders).toHaveLength(1);
      expect(reminders[0]!.kind).toBe("conflict");
    });
  });

  describe("#given aheadCount with no push failure", () => {
    const snapshot: RepoStatusSnapshot = {
      dirtyPaths: [],
      conflictState: "none",
      aheadCount: 3,
    };

    it("#then no push_failed reminder (ahead without failure is not a failure)", () => {
      const state = createRemindersState();
      const reminders = generateReminders(state, snapshot);

      expect(reminders).toEqual([]);
    });
  });

  describe("#given a dirty snapshot then clean then dirty with different paths", () => {
    it("#then re-triggering with different paths re-emits after clear", () => {
      const state = createRemindersState();
      const first = generateReminders(state, {
        dirtyPaths: ["a.md"],
        conflictState: "none",
        aheadCount: 0,
      });
      expect(first).toHaveLength(1);

      // clear
      generateReminders(state, {
        dirtyPaths: [],
        conflictState: "none",
        aheadCount: 0,
      });

      const retriggered = generateReminders(state, {
        dirtyPaths: ["b.md", "c.md"],
        conflictState: "none",
        aheadCount: 0,
      });
      expect(retriggered).toHaveLength(1);
      expect(retriggered[0]!.text).toContain("b.md");
    });
  });

  describe("#given state persistence across calls", () => {
    it("#then the same state object tracks emitted conditions across multiple generate calls", () => {
      const state: RemindersState = createRemindersState();

      // dirty
      expect(
        generateReminders(state, {
          dirtyPaths: ["x.md"],
          conflictState: "none",
          aheadCount: 0,
        }),
      ).toHaveLength(1);
      // same dirty — deduped
      expect(
        generateReminders(state, {
          dirtyPaths: ["x.md"],
          conflictState: "none",
          aheadCount: 0,
        }),
      ).toHaveLength(0);
      // conflict emerges (different condition)
      expect(
        generateReminders(state, {
          dirtyPaths: [],
          conflictState: "merge",
          aheadCount: 0,
        }),
      ).toHaveLength(1);
      // same conflict — deduped
      expect(
        generateReminders(state, {
          dirtyPaths: [],
          conflictState: "merge",
          aheadCount: 0,
        }),
      ).toHaveLength(0);
      // clean — clears
      expect(
        generateReminders(state, {
          dirtyPaths: [],
          conflictState: "none",
          aheadCount: 0,
        }),
      ).toHaveLength(0);
      // dirty again — re-emits
      const final = generateReminders(state, {
        dirtyPaths: ["y.md"],
        conflictState: "none",
        aheadCount: 0,
      });
      expect(final).toHaveLength(1);
      expect(final[0]!.kind).toBe("dirty");
    });
  });

  describe("#given reminder has stable machine key", () => {
    it("#then Reminder.kind values are the expected union", () => {
      const state = createRemindersState();
      const dirty: Reminder | undefined = generateReminders(state, {
        dirtyPaths: ["a"],
        conflictState: "none",
        aheadCount: 0,
      })[0];
      const conflict: Reminder | undefined = generateReminders(state, {
        dirtyPaths: [],
        conflictState: "merge",
        aheadCount: 0,
      })[0];
      // clear to allow push_failed
      generateReminders(state, {
        dirtyPaths: [],
        conflictState: "none",
        aheadCount: 0,
      });
      const pushFailed: Reminder | undefined = generateReminders(state, {
        dirtyPaths: [],
        conflictState: "none",
        aheadCount: 1,
        lastPushFailed: { reason: "timeout" },
      })[0];

      expect(dirty?.kind).toBe("dirty");
      expect(conflict?.kind).toBe("conflict");
      expect(pushFailed?.kind).toBe("push_failed");
    });
  });
});
