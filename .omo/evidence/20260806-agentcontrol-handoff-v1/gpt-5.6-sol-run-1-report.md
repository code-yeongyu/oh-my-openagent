## Flow

### Public launch contract

- The OpenCode adapter exposes exactly `Execute`, `Explore`, `Plan`, `Research`, and `Dispatch` as launch tools. The four direct actions are built through `createAgentAction`, whose schema makes `handoff` a non-empty required string; Dispatch declares the same required field separately (`packages/omo-opencode/src/tools/agentcontrol/tools.ts:52-69`, `packages/omo-opencode/src/tools/agentcontrol/tools.ts:105-119`). The adapter passes the full input unchanged to the MCP runtime for direct actions and Dispatch (`packages/omo-opencode/src/tools/agentcontrol/tools.ts:73-75`, `packages/omo-opencode/src/tools/agentcontrol/tools.ts:120-122`).
- The Python MCP schema independently requires `handoff` for all four direct action schemas and for Dispatch (`tools/agent_control/mcp_server.py:300-337`, `tools/agent_control/mcp_server.py:343-370`). The adapter test asserts all five fields are non-optional and that the five supplied paths reach the runtime unchanged (`packages/omo-opencode/src/tools/agentcontrol/agentcontrol.test.ts:52-62`, `packages/omo-opencode/src/tools/agentcontrol/agentcontrol.test.ts:139-166`).

### Validation and launch ordering

1. `call_tool` maps each direct public action to its lowercase contract action, calls `_validate_handoff`, returns immediately on a rejection dictionary, and only then calls `spawn`; Dispatch follows the same sequence before calling `dispatch` (`tools/agent_control/mcp_server.py:548-565`).
2. `_validate_handoff` rejects an absent/blank value and translates typed validator failures to `{status: "REJECTED", error, detail}` (`tools/agent_control/mcp_server.py:582-590`).
3. Therefore direct worker creation cannot precede validation: the first direct ledger insertion is inside `spawn` at `ledger.add_worker` (`tools/agent_control/mcp_server.py:649-661`, `tools/agent_control/mcp_server.py:696-704`). Dispatch validation likewise precedes both its first workflow write and pending worker insertion, which occur only inside `dispatch` (`tools/agent_control/mcp_server.py:816-840`, `tools/agent_control/mcp_server.py:842-856`).
4. The focused missing-handoff test observes `HANDOFF_REQUIRED` and an empty ledger after a rejected Explore call (`tests/agent_control/test_mcp_v3.py:2143-2151`).

### Trusted metadata propagation

- Successful validation returns immutable metadata containing the handoff ID, normalized action, resolved absolute `Path`, SHA-256 of the exact bytes, and declared source revision; the public response deliberately exposes only ID, absolute path, and digest (`tools/agent_control/handoff.py:36-45`, `tools/agent_control/handoff.py:137-143`).
- The ledger schema and migration preserve `handoff_id`, `handoff_path`, and `handoff_sha256`, including upgrades of existing databases (`tools/agent_control/ledger.py:29-59`, `tools/agent_control/ledger.py:82-105`). `add_worker` writes all three atomically with the worker row (`tools/agent_control/ledger.py:124-170`). Direct spawn supplies the validated values to that insertion (`tools/agent_control/mcp_server.py:696-704`). Dispatch supplies the same shared values to every pending item row (`tools/agent_control/mcp_server.py:842-856`).
- Direct workers receive those values as `AGENT_CONTROL_HANDOFF_ID`, `AGENT_CONTROL_HANDOFF_PATH`, and `AGENT_CONTROL_HANDOFF_SHA256` (`tools/agent_control/mcp_server.py:722-737`). Pending Dispatch workers later reconstruct the same environment from their ledger row, so queue delay/restart does not lose the launch metadata (`tools/agent_control/mcp_server.py:936-951`). Both launch responses return `handoff.public()` (`tools/agent_control/mcp_server.py:811-814`, `tools/agent_control/mcp_server.py:883-885`).
- Focused tests verify the direct response and environment (`tests/agent_control/test_mcp_v3.py:2184-2203`) and verify that both Dispatch workers share the same ID/path/digest in their environments and persisted rows (`tests/agent_control/test_mcp_v3.py:2206-2229`).

### Worker prompt behavior

- Worker configuration is activated only when `AGENT_CONTROL_ROLE=worker`; it selects the matching AgentControl preset, builds runtime JSON from name, kind, report path, handoff ID/path/digest, and optional worktree/branch, then appends the contract to the selected system prompt (`packages/omo-opencode/src/plugin-handlers/agent-config-finalizer.ts:16-45`, `packages/omo-opencode/src/plugin-handlers/agent-config-finalizer.ts:47-61`).
- The contract orders the worker to read the handoff before any other work, treat prior claims and decisions as inputs rather than conclusions, independently inspect authoritative sources, honor scope/acceptance/mutation/verification clauses, and report a blocker then stop if it cannot read the document (`packages/omo-opencode/src/plugin-handlers/agent-config-finalizer.ts:41-44`).
- Runtime JSON escapes `<` and `>` before embedding, preventing metadata strings from terminating the XML-like boundary (`packages/omo-opencode/src/plugin-handlers/agent-config-finalizer.ts:38-44`). Tests pin the complete injected metadata, read-first/revalidation text, blocker behavior, and boundary escaping (`packages/omo-opencode/src/plugin-handlers/agent-config-finalizer.test.ts:102-143`, `packages/omo-opencode/src/plugin-handlers/agent-config-finalizer.test.ts:145-169`).

## Rejection

`validate_handoff` performs these checks in source order:

1. **Path/input:** nonblank string; relative paths are rooted at the resolved launch project; `resolve(strict=True)` requires existence and resolves symlinks; the resolved target must remain under the project and be a regular file (`tools/agent_control/handoff.py:93-107`).
2. **Size/readability:** stat must succeed, size must not exceed 128 KiB, bytes must be readable and valid UTF-8 (`tools/agent_control/handoff.py:10-10`, `tools/agent_control/handoff.py:108-118`).
3. **Frontmatter/metadata:** first and closing `---` are mandatory; each nonblank metadata line must match the restricted key/value syntax; duplicate keys fail; `schema`, `id`, `action`, `projectRoot`, `sourceRevision`, and `status` must all be nonempty (`tools/agent_control/handoff.py:13-15`, `tools/agent_control/handoff.py:48-70`).
4. **Semantic metadata:** schema must equal `agentcontrol-handoff/v1`; ID must start with a lowercase letter and contain at most 64 lowercase alphanumeric/underscore/hyphen characters; declared action must exactly match the requested lowercase action; status must be `ready`; and the declared project root, with `.` meaning the launch root, must resolve to that root (`tools/agent_control/handoff.py:10-12`, `tools/agent_control/handoff.py:119-135`).
5. **Sections:** the nine base sections are `Goal`, `Done when`, `Workspace`, `Scope`, `Source map`, `Claims and decisions`, `Acceptance atoms`, `Verification`, and `Deliverable`; `execute` and `dispatch` additionally require `Mutation boundary`. Duplicate, missing, or empty required sections fail (`tools/agent_control/handoff.py:16-26`, `tools/agent_control/handoff.py:73-90`).
6. **Digest:** only after all checks pass does the validator return SHA-256 over the original raw bytes (`tools/agent_control/handoff.py:136-143`).

Focused parameterized tests pin empty required content, action mismatch, project escape, and oversize rejection (`tests/agent_control/test_mcp_v3.py:2154-2181`).

## Dashboard

- Each Dispatch snapshot copies launch-time `handoff_id`, absolute path, and digest from the worker row, plus a computed integrity status and document body (`tools/agent_control/monitor.py:130-147`). The wide inspector renders `handoff <id> · <status>` (`tools/agent_control/monitor.py:415-425`), and both complete/in-progress footers advertise `H handoff` (`tools/agent_control/monitor.py:459-469`).
- Pressing `H` switches the selected worker to the handoff view (`tools/agent_control/monitor.py:803-810`). That view renders ID, integrity status, launch-time SHA-256, path, and scrollable document content (`tools/agent_control/monitor.py:511-545`); the interactive loop routes the handoff view to this renderer (`tools/agent_control/monitor.py:713-716`).
- Substitution defense is fail-closed for display: `_load_handoff` resolves the current path, requires it to remain a project-local regular file, enforces the same byte cap and UTF-8 decoding, hashes current bytes, and returns content only if the digest equals the persisted launch-time digest. A mismatch returns `changed` with an empty body (`tools/agent_control/monitor.py:63-83`).
- The shared-handoff cache is local to one `snapshot` refresh. It is keyed by `(handoff_path, handoff_sha256)` and calls `_load_handoff` only once per distinct key, so all workers sharing a handoff reuse one read/hash during that refresh (`tools/agent_control/monitor.py:86-104`, `tools/agent_control/monitor.py:130-133`). A new refresh creates a new cache, allowing changes to be detected.
- The focused dashboard test pins verified metadata/body, inspector text, the `H` affordance, full detail rendering, then mutates the file and proves status becomes `changed`, the body becomes empty, and substituted text is not rendered (`tests/agent_control/test_mcp_v3.py:2232-2260`).

## Risks

- **Worker-side digest enforcement is instructional, not mechanical.** The worker receives the launch digest and is told to read/revalidate, but the runtime does not itself open and re-hash the handoff before model task work. A post-validation substitution is mechanically suppressed in the Dispatch dashboard, while a worker must notice/compare the supplied digest itself (`tools/agent_control/mcp_server.py:722-737`, `packages/omo-opencode/src/plugin-handlers/agent-config-finalizer.ts:41-44`, `tools/agent_control/monitor.py:80-83`).
- **`sourceRevision` is presence-only.** It is persisted in the validator result but is neither exposed in `public()` nor checked against repository HEAD, so revision freshness remains a worker revalidation responsibility (`tools/agent_control/handoff.py:36-45`, `tools/agent_control/handoff.py:119-143`).
- **The cache is intentionally refresh-scoped.** This avoids repeated reads among shared workers but performs one read/hash again on every monitor refresh; that is the integrity/performance tradeoff visible in `snapshot` (`tools/agent_control/monitor.py:86-104`, `tools/agent_control/monitor.py:130-133`).