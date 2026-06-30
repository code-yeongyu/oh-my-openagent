# Discord Report - Sanitized Summary

Source:
- Private Discord report supplied by the requester.
- Raw Discord content, guild/channel identifiers, message URL, channel name, and access metadata are intentionally not copied here.

Issue summary:
- `omo doctor` can report the loaded OpenCode plugin as outdated after an update attempt.
- The suggested update path uses `bun add oh-my-openagent@latest` inside the OpenCode package cache.
- On the reported server, `bun add` installed the latest package but also reported blocked postinstall scripts.
- After that, `oh-my-openagent -v` still reported the old plugin version, requiring manual cleanup/fixup.

Expected behavior:
- Update recovery should be actionable in one pass.
- If Bun blocks postinstall scripts and that prevents the platform binary/version shim from updating, the doctor/update guidance should detect or explain the Bun trust step instead of leaving the user with a stale CLI/plugin.
