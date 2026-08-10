// Memory git status reminders — pure generator with condition-key dedupe.
// Ported semantics from letta reminders/memory-git-sync.ts:16-100.
export {
  createRemindersState,
  generateReminders,
  reminderKindFor,
  type ConflictState,
  type PushFailure,
  type RepoStatusSnapshot,
  type Reminder,
  type ReminderKind,
  type RemindersState,
} from "./reminders";
