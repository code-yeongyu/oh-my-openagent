# PR 5987 OpenCode QA

Runs the real installed `opencode` with the local OMO plugin and a local fake model under isolated XDG directories. The custom primary `probe-parent` maps categories to `probe-worker`; the probe asks the model to call `task(category="quick")`, asserts the child returns `CHILD_DONE`, asserts the sandbox DB records the child as `probe-worker`, and proves the real OpenCode session count is unchanged.

Unit/integration evidence separately proves a denied resolved target prevents launch. Raw model requests and secret-bearing environment output are omitted; the fake provider uses no real credential.
