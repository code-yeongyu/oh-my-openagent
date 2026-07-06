# senpi-task

Senpi-coupled task adapter state package.

This package may depend on Senpi and adapter-facing core packages. Do not import `packages/omo-opencode` or `@oh-my-opencode/omo-opencode` from here.

State and store modules must stay runnable without runtime Senpi imports. Keep Senpi API surface checks in dedicated tripwire tests or runner-facing modules.
