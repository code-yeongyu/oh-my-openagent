# src/tools/look-at/ -- Image and PDF Analysis Tool

**Generated:** 2026-05-18

## OVERVIEW

14 files. The `look_at` tool delegates image, PDF, and diagram analysis to the `multimodal-looker` subagent only when the current model is not known to support native vision. If the current parent-session model is in the vision-capable model cache, `look_at` skips child-session delegation and tells the caller to use the native `Read` path so the current model can inspect the media directly. Conditional gate: tool is only registered when `multimodal-looker` is not in `disabled_agents`. Default subagent model: gpt-5.5 medium. This is a summary extractor, not a precise reader.

## EXECUTION FLOW

1. **Args** (`look-at-arguments.ts`) -- normalize `file_path`/`image_data` aliases, validate one-of requirement, reject remote URLs
2. **Prep** (`look-at-input-preparer.ts`) -- resolve path, detect MIME from extension or Base64 header, convert unsupported images to JPEG
3. **Native vision check** (`tools.ts`) -- if the current session message model matches the vision-capable cache, skip delegation and return native `Read` guidance
4. **Spawn** (`look-at-session-runner.ts`) -- otherwise create child session with `multimodal-looker` agent, attach file as message part, disable `task`/`call_omo_agent`/`look_at` to prevent recursion
5. **Poll** (`session-poller.ts`) -- wait until idle (1s interval, 120s timeout)
6. **Extract** (`assistant-message-extractor.ts`) -- pull latest assistant text from session messages
7. **Return** -- summary text back to caller

## FILE CATALOG

| File | Responsibility |
|------|----------------|
| `tools.ts` | `createLookAt()` factory -- tool schema + entry point |
| `look-at-arguments.ts` | Zod arg schema, normalize aliases, validate inputs |
| `look-at-input-preparer.ts` | Build `LookAtFilePart` from path or base64; trigger conversion if needed |
| `look-at-prompt.ts` | System prompt for the multimodal session |
| `look-at-session-runner.ts` | Orchestrate child session creation, prompt dispatch, message fetch |
| `session-poller.ts` | Poll session status until idle |
| `assistant-message-extractor.ts` | Extract latest assistant text from raw session messages |
| `image-converter.ts` | Convert HEIC/WebP/RAW/PSD to JPEG via sips or ImageMagick |
| `mime-type-inference.ts` | Detect MIME from file extension or Base64 header |
| `missing-file-error.ts` | Clear `ENOENT` error message when file is missing |
| `multimodal-agent-metadata.ts` | Resolve actual model for multimodal-looker from config or dynamic pipeline |
| `multimodal-fallback-chain.ts` | Build vision-capable fallback chain: kimi-k2.6, glm-4.6v, gpt-5-nano |
| `constants.ts` | `MULTIMODAL_LOOKER_AGENT`, `LOOK_AT_DESCRIPTION` |
| `types.ts` | `LookAtArgs` interface |

## GATE

Conditional. Tool is registered only when `multimodal-looker` is absent from `disabled_agents`.

## USE CASE

PDFs, screenshots, diagrams -- quick summary extraction. NOT for visual precision, aesthetic evaluation, or exact accuracy. Use the Read tool for those cases instead.

## DISTINCTION

This is the TOOL that usually DELEGATES TO the `multimodal-looker` AGENT. The agent lives in `src/agents/builtin-agents/multimodal-looker.ts`; this tool is the invocation harness. Native-vision parent models bypass that delegation path.

## NOTES

- Temporary converted images are cleaned up in `finally` blocks
- The subagent has `read` tool disabled by default (`READ_ENABLED = false`); the file is passed as an attachment
