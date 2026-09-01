# Plan

- Add a scheduler regression test and fake-manager owner-conflict fixture; run it before production changes and capture RED output.
- Add manager runtime-fallback abort tests for terminal waiter behavior; run them before production changes and capture RED output.
- Implement owner-conflict adoption in the DAG scheduler.
- Guard manager waiters from nonterminal records and terminalize fallback launch aborts.
- Run focused GREEN tests, diagnostics, package suite, and Senpi QA evidence as required.
- Regenerate tracked Senpi bundle artifacts, commit atomically, push, open a PR to dev, and enable auto-merge.
