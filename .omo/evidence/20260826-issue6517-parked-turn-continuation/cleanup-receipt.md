# Cleanup receipt

| Resource | Disposal | Verification |
|---|---|---|
| 6 QA sandboxes `/tmp/omo-qa-sandbox.*` (XDG dirs, cloned auth copies, sandbox DBs, opencode servers) | `rm -rf /tmp/omo-qa-sandbox.*` after servers killed (`kill $SERVER_PID` + wait in qa-live-server.sh) | `ls /tmp | grep -c omo-qa-sandbox` -> 0 |
| opencode serve pid 3145574 (qa-live-server) | `kill` + `wait` inside script before log grep | script proceeded to log grep only after wait |
| Real-side state | Never written: auth.json cloned read-only (sha256 identical before/after); real DB opened readonly for counts; forbidden dirs untouched | `qa/isolation-before.txt` vs `qa/isolation-after.txt`; 0 rows for all 4 QA session IDs in real DB |
| Generated-bundle churn from postinstall/codegraph bootstrap (7 tracked files, twice) | `git checkout -- <files>` | final `git status --porcelain`: only the 8 lane files remain |
| Worktree | left intact with change set for orchestrator verification | branch `fix/parked-turn-continuation-6517` @ clean status for lane files |

No background daemons, tmux sessions, browsers, or bound ports remain (tmux unavailable; servers were per-run children).
