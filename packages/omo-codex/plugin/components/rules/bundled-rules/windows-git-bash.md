---
description: Windows Git Bash guidance for Codex
alwaysApply: true
---

On Windows native Codex sessions, prefer Git Bash for shell commands.

Prefer the `git_bash` MCP for shell commands — it resolves real Git Bash for you.

If you run bash directly, pass the ABSOLUTE Git Bash path from `OMO_CODEX_GIT_BASH_PATH` or `C:\Program Files\Git\bin\bash.exe`. NEVER set the shell to a bare `bash` (no `shell:"bash"`): a bare `bash` on PATH frequently resolves to WSL's `C:\Windows\System32\bash.exe`, which runs inside the Linux VM (paths like `/mnt/c/...`, `whoami=root`) where Windows tools such as `codex`/`omo` are NOT on PATH and your edits land in the wrong place.

Use PowerShell only for Windows-native operations that need PowerShell.
