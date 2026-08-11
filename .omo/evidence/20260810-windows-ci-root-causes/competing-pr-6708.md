# Competing install fix - PR #6708

PR #6708 changes Senpi toolkit staging to remove `packages/omo-codex/plugin/node_modules` before running `npm ci`.

PR:
https://github.com/code-yeongyu/oh-my-openagent/pull/6708

## Root-cause assessment

The root build graph still schedules `codex-plugin` and `senpi-plugin` independently. Both can enter `npm ci` for the same plugin tree. Removing the tree in one process does not establish a single owner and can race with the other process deleting or extracting it.

The accepted root fix for this run is to add the missing graph dependency so `codex-plugin` finishes before `senpi-plugin` starts. If PR #6708 lands first, its redundant cleanup must be removed during rebase so the final state contains no workaround.

## First check observation

The first PR #6708 check set was not fully green when captured. Required Windows test execution remained pending while another check had already failed. No admin merge or bypass is acceptable.
