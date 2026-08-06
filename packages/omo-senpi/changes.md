## 2026-08-06 — Refresh local Senpi installs before activation

Source installs now rebuild every generated OMO Senpi artifact even when the previous bundle is
complete, and they replace older settings entries whose package manifest is also
`@code-yeongyu/omo-senpi`. This prevents a copied, stale extension from continuing to run legacy
task lifecycle code after the source tree has gained crash-revival fixes.

Keep the distinction between source and packed installs: source installs must refresh generated
artifacts, while packed installs must verify their immutable staged artifacts without attempting a
build. Do not remove package-identity replacement; loading stale and current OMO package paths
together can register duplicate components and retain obsolete task behavior.

The parent-restart QA driver proves the integration boundary by SIGKILLing a real Senpi parent,
reopening the same session and task state, and requiring the original in-process child task to
continue without becoming `lost`. It also verifies process and temporary sandbox cleanup.
