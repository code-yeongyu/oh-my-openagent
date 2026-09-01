# Task 2 evidence - builtin curated agent definitions

## What was tested

- All five definitions retain `mode: "subagent"`, `executionMode: "in-process"`, non-empty Senpi-adapted prompts, stripped legacy brand tags, and the exact nine-name allowlist required by the plan.
- Prompt tests reject unavailable guidance including `call_omo_agent`, `background_output`, Context7/web tools, todo tools, ast-grep helpers, clone/npm/history shell commands, and related sentinels.
- The same-name curated `bash` implementation accepts only a structured `program: "curl" | "gh"` plus an argument vector, invokes it with `execFile` rather than a shell, and positively allowlists read-only operations.
- Mutation-capable curl flags, GitHub API methods, cloning, request bodies, output files, and arbitrary commands are rejected in unit tests.

## What was observed

- The focused final run reported 7 builtin-definition tests and 2 curated-bash tests passing.
- The verifier's original unrestricted-shell reproduction created a file. After the override was installed, the live child completed `curl --version`, rejected `curl --output ...`, and left both forbidden files absent.

## Why it is enough

The definition still exposes the plan's literal `bash` tool name, but curated children receive a shell-free implementation whose schema and command planner cannot express a general shell command.

## What was omitted

No claim is made that Senpi's ordinary builtin bash is read-only; it is replaced only for the five curated in-process agents.
