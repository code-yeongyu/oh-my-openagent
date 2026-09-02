# QA evidence: Windows sweep launcher resolution (#6747)

Branch: fix/bip-7213 (based on origin/dev)

- RED: a temporary minimal repro against the base `exec.ts` failed at the launcher-resolution assertion because bare `powershell.exe` was not found with a curated PATH (`Received promise that rejected`).
- GREEN: focused process-sweep test passed, 7 pass / 0 fail.
- Package QA: `bun test packages/utils` passed; `bun run --cwd packages/utils typecheck` passed.
- The fix resolves PowerShell and taskkill from `%SystemRoot%`/`windir` System32 when present, preserves bare-name fallback, and annotates ENOENT with the attempted launcher.
