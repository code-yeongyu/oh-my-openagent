# PR 5987 OpenCode QA

Runs the real installed `opencode` with the local OMO plugin and a local fake model under isolated XDG directories. The custom primary `probe-parent` maps categories to `probe-worker`; the first probe asks the model to call `task(category="quick")`, asserts the child returns `CHILD_DONE`, and asserts the sandbox DB records the child as `probe-worker`.

The second probe drives `team_create` from the real Sisyphus agent with a stack-local `category_target_agent` override. It creates a category worker and asserts the persisted runtime member has `subagent_type: probe-worker`, proving team creation uses the caller agent type rather than the lead member name. Both runs share the isolated sandbox and prove the real OpenCode session count is unchanged.

Permission ordering was also tested with:

```text
bun test packages/omo-opencode/src/tools/delegate-task/category-target-permission.test.ts
```

Both tests passed. The resolved target was presented to `ctx.ask`, and a rejected permission request left the background launch count at zero. Captured output: `permission-denial-test.txt`.

Together, the real harness run covers successful stack-local routing and isolated child execution, while the focused permission test covers the denial boundary before launch. Raw model requests and secret-bearing environment output are omitted; the fake provider uses no real credential.
