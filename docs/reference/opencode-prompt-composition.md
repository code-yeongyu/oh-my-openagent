# OpenCode prompt composition

The engine owns model-specific prompt content. The OpenCode adapter imports
`@code-yeongyu/senpi/prompt-presets`; it never selects a local model body.
The selected `provider/model` string is split at its first slash. A matching
Senpi catalog entry supplies the same display name and preset metadata used
by Native; uncatalogued IDs retain their provider and full remaining ID.

For each supported agent/model pair, generation calls the Native
`resolvePreset` with automatic selection. Models without a preset use
`buildDynamicSystemPrompt`, the Native fallback. The builder receives the
terminal surface, OmO application name and actual registered tool names and descriptions. Context is appended by the
OpenCode host rather than discovered by the engine's resource loader.

## The one host transform

`native-model-prompt.ts` owns the only transform. OpenCode's `question` and
`todowrite` capabilities enter the builder under Native's `ask_user_question`
and `todo` names; the generated text translates the question identifier and
backtick-delimited todo tool name back. When the existing task-system mode is
enabled, that identifier instead becomes `task_create` / `task_update` /
`task_list` / `task_get`, matching the role's tracking contract. The Native-only
`waitForAnswer true when the next step depends on the answer` parenthesis is
removed: OpenCode's question tool waits itself and has no such parameter. No
model-family text, whitespace, headings or calibration is normalized.

The transformed core is followed by a JSON model identity containing the
actual provider, full model ID and selected preset, then the existing OpenCode
role append. The core and identity are enclosed in an `omo-model-core` frame
whose header carries only a short reference (`ref="<16 hex>"`). The frame's context (configured model,
tool names and snippets, permission rules, task-system mode and optional Hephaestus restriction) stays in
the plugin process, keyed by that reference, so none of it is sent to the model. The per-request system
transform rebuilds just that frame for the actual runtime model, preserving role and user appends.

Tool snippets are one line per tool, like Native's author-written `promptSnippet`: OpenCode tools only
have a full description, which the model already gets in the tools array, so the snippet is the
description's first paragraph, sentence by sentence until it is at least 40 characters, capped at 200. This
also covers model changes after registration and model overrides applied by
categories. Unframed custom prompts are left alone; malformed frames are not
interpreted. An unsupported Hephaestus runtime model leaves the previous frame
untouched; it must not turn an allowed user override into a failed request.

The original role artifacts retain validation, verdict, output and tracking
protocols, including Momus's `[OKAY]` / `[REJECT]` tokens. The append describes the role's scope, available agents,
categories and skills, and the optional task-system interface. User prompt
appends retain their existing host ordering; frame replacement preserves them
byte for byte. The existing registration pipeline can append environment and
skill context outside the model core. Prometheus keeps its single planning-role asset and
the ulw-plan workflow; it now receives the same model core as other agents.

Native has no Sisyphus/Junior/Atlas persona selector. Its explicit custom
system-prompt override replaces the model core; this adapter does not use
that override. Roles are an OpenCode-specific append, not a second source
of Native model calibration. Existing OpenCode role variants remain where
their instructions differ. Explore, librarian and multimodal-looker are
outside this composition change and keep their dev prompts unchanged.

Hephaestus retains its existing supported-model predicate at construction.
Content parity covers the models each agent permits; this change
does not expand model eligibility.

## Tool inputs

`plugin-interface.ts` supplies the actual plugin tool definitions after agent
registration and permission assembly. It records host-provided builtin/MCP
descriptions through `tool.definition`; the request transform refreshes tool
inputs even when the model has not changed. Global and per-agent permission
rules, current session permissions and disabled tools filter the selected names.
Session rules are read only during a request, with a bounded deadline; an
unavailable session snapshot leaves the last tool context intact. Session
restrictions are not baked into the persistent frame, so a CLI-only denial
cannot leak into another session or later turn. No invented descriptions
or host API calls during initialization are needed. Tool metadata belongs to
one plugin instance, not a global registry shared across projects.

## Verification

The parity matrix compares actual agent factory output with Native-generated
content with real grep/glob definitions plus this transform. It separately
checks that runtime replacement preserves the original role append. It enumerates
catalog IDs as production `provider/model` strings and covers the unknown-model
fallback too. Transform tests separately cover tool names, model identifiers,
dynamic role context and user appends. Mutation runs substitute a different
model's body and erase an identifier at the plugin boundary; both must fail.
