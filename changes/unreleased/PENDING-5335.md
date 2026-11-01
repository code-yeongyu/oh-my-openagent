### Changed

- The system prompt's tool guidelines for `task` and `memory` shrink to one bullet each. The dropped bullets repeated rules the tool descriptions and parameter schemas already state (background spawns, no model with a category, `task_send` continuation, `task_output` peeks, auto-commit with a reason, markdown with YAML frontmatter), so every first-turn prompt carries fewer duplicate tokens without losing a rule. (code-yeongyu/senpi#5335)
