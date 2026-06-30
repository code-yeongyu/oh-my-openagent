# Discord Report - Sanitized Summary

Source:
- URL: https://discord.com/channels/1452487457085063218/1490539106797621259/1521265774658977943
- Access method: `aside repl` opened the logged-in Discord web app and loaded the linked message in `#general-ko`.
- Raw Discord content is intentionally not copied here.

Issue summary:
- `omo doctor` can report the loaded OpenCode plugin as outdated after an update attempt.
- The suggested update path uses `bun add oh-my-openagent@latest` inside the OpenCode package cache.
- On the reported server, `bun add` installed the latest package but also reported blocked postinstall scripts.
- After that, `oh-my-openagent -v` still reported the old plugin version, requiring manual cleanup/fixup.

Expected behavior:
- Update recovery should be actionable in one pass.
- If Bun blocks postinstall scripts and that prevents the platform binary/version shim from updating, the doctor/update guidance should detect or explain the Bun trust step instead of leaving the user with a stale CLI/plugin.
