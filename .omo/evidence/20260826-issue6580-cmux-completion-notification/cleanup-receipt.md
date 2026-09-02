# Cleanup receipt

- The disposable clean-base comparison worktree was removed after its result was summarized.
- Temporary build-determinism probes and base-driver output were removed.
- The debug journal and its clone-local exclude entry were removed.
- The real Senpi driver reported zero leaked PIDs and no changed real-Senpi paths for both branch and base runs.
- Unrelated Codex generated outputs have zero net diff against `origin/dev`.
