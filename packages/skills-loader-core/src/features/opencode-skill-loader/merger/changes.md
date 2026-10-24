## 2026-10-22 - Report configured skill read failures (#10693)

Configured file entries report missing or unreadable paths as load errors, while
real escaping links retain the security diagnostic. Neither failure loads a skill.
