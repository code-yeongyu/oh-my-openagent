`omo remote <verb> --json` now prints a parseable JSON refusal object (`{kind:"error", code:"host_unavailable", message, next_action, details:{reason}}`) on stdout when the signed-out account precondition stops the verb; the human notice stays on stderr for non-JSON runs and the exit code is unchanged.

<!-- changes-log: changes/unreleased/15181-json-refusal.md -->
