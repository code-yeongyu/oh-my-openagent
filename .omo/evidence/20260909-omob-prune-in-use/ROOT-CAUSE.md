# Root cause capture (mengmotaHost, 2026-09-09 11:3x KST)

## Reported symptom
```
Memorian gate failed · session_create_failed
ENOENT: no such file or directory, open '/Users/yeongyu/.omo/binary-runtime/0.0.0-omob.749b777.eab8c4b/plugin/extensions/memorian-persona.md'
```

## Observations
- `ls ~/.omo/binary-runtime/` -> `0.0.0-omob.0d6ff53.096615a` (mtime 11:18) and `0.0.0-omob.0d6ff53.c7d812e` (mtime 11:23); NO `0.0.0-omob.749b777.eab8c4b`.
- Both surviving omob runtimes DO carry `plugin/extensions/memorian-persona.md` (persona staging is correct).
- `ps -axo pid,lstart,command | grep binary-runtime/0.0.0-omob`:
  ```
  84145 Tue Sep  8 23:37:11 2026  /Users/yeongyu/.omo/binary-runtime/0.0.0-omob.749b777.eab8c4b/omo
  54720 Wed Sep  9 01:16:59 2026  /Users/yeongyu/.omo/binary-runtime/0.0.0-omob.749b777.eab8c4b/omo
  ```
  Two live sessions still execute from the deleted runtime dir.
- `~/.local/bin/omob` is the auto-update launcher: it runs
  `build-omob.ts --if-changed --binary-only ... --keep 2` on EVERY launch. Two upstream advances today
  produced two rebuilds; each rebuild's `pruneOmobRuntimes(keep=2)` retired the oldest dev runtime by mtime,
  which was the one the live sessions were running from.
- `packages/memory-core/src/recall/assets/assets.ts` reads `memorian-persona.md` lazily
  (`readFileSync(join(dirname(fileURLToPath(import.meta.url)), "memorian-persona.md"))`), so the first memorian
  judge after the prune surfaced the ENOENT. Skills, other personas and sidecars are read the same way.

## Conclusion
Not a staging bug: the prune deleted a runtime that live processes still executed from. Fix = the prune must
treat a runtime dir referenced by any live process command as in use and never delete it.
