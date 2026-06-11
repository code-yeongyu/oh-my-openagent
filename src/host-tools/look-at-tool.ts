import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { HostKind, HostSessionActions, HostSessionContext, HostToolDefinition, HostToolResult, JsonObject } from "../host-contract"
import { LOOK_AT_DESCRIPTION } from "../tools/look-at/constants"
import { normalizeArgs, validateArgs } from "../tools/look-at/look-at-arguments"
import { buildLookAtPrompt } from "../tools/look-at/look-at-prompt"
import { extractBase64Data, inferMimeTypeFromBase64 } from "../tools/look-at/mime-type-inference"
import { prepareLookAtInput, type LookAtFilePart } from "../tools/look-at/look-at-input-preparer"
import type { LookAtArgs } from "../tools/look-at/types"
import type { LookAtArgsWithAlias } from "../tools/look-at/look-at-arguments"
import { registerTargetTool, type TargetToolDefinition, type TargetToolRegistry } from "./tool-registration"

const LOOK_AT_PARAMETERS: JsonObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    file_path: { type: "string", description: "Absolute path to the file to analyze" },
    image_data: { type: "string", description: "Base64 encoded image data for clipboard or pasted images" },
    goal: { type: "string", description: "What specific information to extract from the file" },
  },
  required: ["goal"],
}

type TargetLookAtDeps = {
  runCli(host: Exclude<HostKind, "opencode">, args: string[], cwd: string, signal?: AbortSignal): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

const DEFAULT_LOOK_AT_DEPS: TargetLookAtDeps = {
  runCli: runTargetLookAtCli,
}

function executableFor(host: Exclude<HostKind, "opencode">): string {
  return host === "oh-my-pi" ? "omp" : "pi"
}

function createDetachedSessionContext(cwd: string): HostSessionContext {
  const actions: HostSessionActions = {
    sendUserMessage: async () => {},
    sendInternalMessage: async () => {},
    appendEntry: async () => {},
    getSessionName: () => undefined,
    setSessionName: async () => {},
    getContextUsage: () => undefined,
    compact: async () => {},
    abort: () => {},
    isIdle: () => true,
    hasPendingMessages: () => false,
  }

  return { id: "target-session", cwd, actions }
}

async function runTargetLookAtCli(
  host: Exclude<HostKind, "opencode">,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executableFor(host), args, {
      cwd,
      env: {
        ...process.env,
        OMO_TARGET_AGENT: "multimodal-looker",
        OMO_TARGET_AGENT_POLICY: "read-only",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    const abort = () => child.kill("SIGTERM")
    signal?.addEventListener("abort", abort, { once: true })
    child.once("error", reject)
    child.once("close", (code) => {
      signal?.removeEventListener("abort", abort)
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1 })
    })
  })
}

function extensionForMime(mimeType: string): string {
  const subtype = mimeType.split("/")[1]?.replace(/[^a-z0-9]+/gi, "").toLowerCase()
  return subtype && subtype.length > 0 ? subtype : "png"
}

async function materializeBase64Image(imageData: string, mimeType = inferMimeTypeFromBase64(imageData)): Promise<{ path: string; cleanup(): Promise<void> }> {
  const tempDir = await mkdtemp(join(tmpdir(), "omo-target-look-at-"))
  const filePath = join(tempDir, `clipboard-image.${extensionForMime(mimeType)}`)
  await writeFile(filePath, Buffer.from(extractBase64Data(imageData), "base64"))
  return {
    path: filePath,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true })
    },
  }
}

async function resolveAttachmentPath(
  args: LookAtArgs,
  filePart: LookAtFilePart,
): Promise<{ filePath: string; isBase64Input: boolean; cleanup(): Promise<void> }> {
  if (filePart.url.startsWith("file:")) {
    return { filePath: fileURLToPath(filePart.url), isBase64Input: Boolean(args.image_data), cleanup: async () => {} }
  }
  if (filePart.url.startsWith("data:")) {
    const materialized = await materializeBase64Image(filePart.url, filePart.mime)
    return { filePath: materialized.path, isBase64Input: true, cleanup: materialized.cleanup }
  }
  throw new Error(`Unsupported look_at attachment URL: ${filePart.url}`)
}

function asTextResult(text: string, isError?: boolean): HostToolResult {
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  }
}

export function createTargetLookAtTool(
  host: Exclude<HostKind, "opencode">,
  cwd: string,
  deps: TargetLookAtDeps = DEFAULT_LOOK_AT_DEPS,
): HostToolDefinition<JsonObject> {
  return {
    name: "look_at",
    label: "look_at",
    description: LOOK_AT_DESCRIPTION,
    parameters: LOOK_AT_PARAMETERS,
    execute: async ({ input, signal }) => {
      const args = normalizeArgs({
        file_path: typeof input.file_path === "string" ? input.file_path : undefined,
        image_data: typeof input.image_data === "string" ? input.image_data : undefined,
        path: typeof input.path === "string" ? input.path : undefined,
        goal: typeof input.goal === "string" ? input.goal : "",
      } satisfies LookAtArgsWithAlias)
      const validationError = validateArgs(args)
      if (validationError) return asTextResult(validationError, true)

      const prepared = prepareLookAtInput(args)
      if (!prepared.ok) return asTextResult(prepared.error, true)

      const attachment = await resolveAttachmentPath(args, prepared.value.filePart)
      try {
        const prompt = buildLookAtPrompt(args.goal, attachment.isBase64Input)
        const result = await deps.runCli(host, ["--print", "--mode", "text", `@${attachment.filePath}`, prompt], cwd, signal)
        if (result.exitCode !== 0) {
          return asTextResult(`Error: target multimodal session failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`, true)
        }
        if (!result.stdout) return asTextResult("Error: No response from target multimodal session", true)
        return asTextResult(result.stdout)
      } finally {
        prepared.value.cleanup()
        await attachment.cleanup()
      }
    },
  }
}

export function registerTargetLookAtTool(options: {
  host: Exclude<HostKind, "opencode">
  registry: TargetToolRegistry
  cwd: string
  deps?: TargetLookAtDeps
}): TargetToolDefinition {
  return registerTargetTool(options.registry, createTargetLookAtTool(options.host, options.cwd, options.deps), {
    host: options.host,
    parameters: { kind: "json-schema", schema: LOOK_AT_PARAMETERS },
    createSessionContext: () => createDetachedSessionContext(options.cwd),
  })
}
