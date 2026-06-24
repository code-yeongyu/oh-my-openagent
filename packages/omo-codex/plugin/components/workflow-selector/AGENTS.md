# Repository Conventions

## Scope

This component owns opt-in LazyCodex automatic workflow selection for Codex `UserPromptSubmit`.

## Constraints

- Default OFF. Enable only with `OMO_CODEX_AUTO_WORKFLOW=1|true|yes|on`.
- Emit bounded `hookSpecificOutput.additionalContext` only. Do not call Codex APIs, run workflows, mutate prompts, or touch files.
- Explicit workflow commands remain authoritative; this selector stays quiet when the prompt already names `ultrawork`, `ulw`, `init-deep`, `ulw-plan`, `start-work`, or `ulw-loop`.
- Keep literal ultrawork triggering in `components/ultrawork`.
