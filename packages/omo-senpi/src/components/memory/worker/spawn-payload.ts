import { chmod, mkdir, readFile, writeFile } from "@oh-my-opencode/memory-core/fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

import {
  loadDreamPersona,
  loadFactsPersona,
  loadMemorianPersona,
  loadReflectionPersona,
  serializeFactsPayload,
  type ReservedRun,
} from "@oh-my-opencode/memory-core"

import {
  MEMORIAN_NUDGE_EXTENSION_FILENAME,
  MEMORIAN_NUDGE_EXTENSION_SOURCE,
} from "./memorian-nudge-extension"

import { estimateSystemTokens } from "../commands/tokens"
import type {
  FactsSpawnArgs,
  MemorianSpawnArgs,
  PrepareFactsSpawnInput,
  PrepareMemorianSpawnInput,
  PrepareReflectionSpawnInput,
  ReflectionSpawnArgs,
  ReflectionSpawnPaths,
} from "./spawn-types"
import { resolveMemoryChildLaunch, resolveSenpiLaunch } from "./senpi-command"

export async function prepareReflectionSpawn(input: PrepareReflectionSpawnInput): Promise<ReflectionSpawnArgs> {
  const sessionDir = join(input.reflectionSessionsDir, safeRunId(input.run.runId))
  await mkdir(sessionDir, { recursive: true, mode: 0o700 })
  const transcript = join(sessionDir, "transcript-payload.json")
  const persona = join(sessionDir, "reflection-persona.md")
  const prompt = join(sessionDir, "reflection-task.md")
  const isDream = input.run.request.trigger === "dream"
  if (isDream && (input.systemTokenBudget === undefined || input.systemTokenTarget === undefined)) {
    throw new TypeError("dream spawn requires a system token budget and target")
  }
  const dreamPaths = isDream ? {
    skillsUsage: join(sessionDir, "skills-usage.json"),
    memoryUsage: join(sessionDir, "memory-usage.json"),
    dreamState: join(sessionDir, "dream-state.json"),
    dreamPolicy: join(sessionDir, "dream-policy.json"),
    systemTokens: join(sessionDir, "system-tokens.json"),
  } : undefined
  const payloadPaths = [
    transcript,
    persona,
    prompt,
    ...(dreamPaths === undefined ? [] : Object.values(dreamPaths)),
  ]
  // Payload files are chmod 0400 after writing, so a reused run directory (retry with the same
  // runId) must relax the mode before rewriting or the open() fails with EACCES.
  const chmodFile = input.chmodFile ?? chmod
  await Promise.all(payloadPaths.map(async (path) => {
    try {
      await chmodFile(path, 0o600)
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error
    }
  }))
  await Promise.all([
    writeFile(transcript, `${JSON.stringify({ schemaVersion: 1, runId: input.run.runId, request: input.run.request }, null, 2)}\n`, "utf8"),
    writeFile(persona, isDream ? loadDreamPersona().markdown : loadReflectionPersona().markdown, "utf8"),
    writeFile(prompt, buildTaskPrompt(input.run, input.worktree.dir, transcript), "utf8"),
    ...(dreamPaths === undefined ? [] : [
      copyJsonOrEmpty(input.skillsUsageSource, dreamPaths.skillsUsage),
      copyJsonOrEmpty(input.memoryUsageSource, dreamPaths.memoryUsage),
      copyJsonOrEmpty(input.dreamStateSource, dreamPaths.dreamState),
      writeFile(dreamPaths.dreamPolicy, `${JSON.stringify({ version: 1, people: input.peoplePolicy }, null, 2)}\n`, "utf8"),
      writeSystemTokenEstimate(input.worktree.dir, dreamPaths.systemTokens),
    ]),
  ])
  await Promise.all(payloadPaths.map((path) => chmod(path, 0o400)))

  const dreamTarget = isDream && input.run.request.targetDoc !== undefined
    ? resolveDreamTarget(input.worktree.dir, input.run.request.targetDoc)
    : undefined
  const paths: ReflectionSpawnPaths = {
    sessionDir,
    worktree: input.worktree.dir,
    gitCommonDir: dirname(input.worktree.commonConfigPath),
    transcript,
    persona,
    prompt,
    ...dreamPaths,
    ...(dreamTarget === undefined ? {} : { dreamTarget }),
  }
  const env: NodeJS.ProcessEnv = {
    ...input.env,
    MEMORY_DIR: input.worktree.dir,
    TRANSCRIPT_PATH: transcript,
    ...(dreamPaths === undefined ? {} : {
      SKILLS_USAGE_PATH: dreamPaths.skillsUsage,
      MEMORY_USAGE_PATH: dreamPaths.memoryUsage,
      DREAM_STATE_PATH: dreamPaths.dreamState,
      DREAM_POLICY_PATH: dreamPaths.dreamPolicy,
      SYSTEM_TOKENS_PATH: dreamPaths.systemTokens,
      SYSTEM_TOKEN_BUDGET: String(input.systemTokenBudget),
      SYSTEM_TOKEN_TARGET: String(input.systemTokenTarget),
      ...(dreamTarget === undefined ? {} : { DREAM_TARGET_PATH: dreamTarget }),
    }),
    SENPI_MEMORY_REFLECTION: "1",
    // A detached child has no controlling terminal, so senpi's PTY-backed bash session fails with
    // "Native PTY session handle is missing write()" and the child could never git-commit its
    // reflection. pi-pty's documented non-interactive override selects the pipe session backend.
    SENPI_PTY_FORCE_PIPE: "1",
  }
  // Verified against senpi packages/coding-agent/src/cli/args.ts and cli/file-processor.ts:
  // -p selects print mode; --system-prompt reads a file path; --tools is a comma allowlist;
  // --no-extensions/--no-skills/--no-prompt-templates/--no-context-files disable discovery;
  // --session-dir isolates JSONL storage; --model/--thinking select the category result; @file
  // loads the mechanics prompt as the initial non-interactive message.
  const args = [
    "-p",
    "--system-prompt", persona,
    "--tools", "bash,edit",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--session-dir", sessionDir,
    "--model", input.model,
    ...(input.thinking === undefined ? [] : ["--thinking", input.thinking]),
    `@${prompt}`,
  ]
  const launch = resolveMemoryChildLaunch(input)
  return {
    runId: input.run.runId,
    attempt: input.attempt ?? 1,
    hardDeadlineAt: input.hardDeadlineAt ?? Date.now() + 15 * 60_000,
    category: input.category,
    conversationIds: input.run.request.conversationIds,
    model: input.model,
    ...(input.thinking === undefined ? {} : { thinking: input.thinking }),
    ...(input.nextAttempt === undefined ? {} : { nextAttempt: input.nextAttempt }),
    kind: input.run.request.trigger === "dream" ? "dream" : "reflection",
    trigger: input.run.request.trigger,
    ...(input.run.request.trigger === "dream" ? { origin: input.run.request.origin } : {}),
    mergePolicy: input.mergePolicy,
    ...(input.run.request.targetDoc === undefined ? {} : { targetDoc: input.run.request.targetDoc }),
    ...(isDream ? {
      systemTokenBudget: input.systemTokenBudget,
      systemTokenTarget: input.systemTokenTarget,
    } : {}),
    worktree: input.worktree,
    command: launch.command,
    args: [...launch.prefixArgs, ...args],
    cwd: input.worktree.dir,
    env,
    detached: true,
    paths,
  }
}

// Fork mode reuses the parent session's request prefix so the provider cache can hit. That cache
// is keyed on the exact system prompt, tool list, and cwd, so this variant must NOT pass
// --system-prompt/--tools/--no-*/--no-context-files and must run in the PARENT cwd. The reflection
// persona and task prompt ride as the initial message (@file) instead of the system prompt.
export async function prepareReflectionForkSpawn(input: PrepareReflectionSpawnInput): Promise<ReflectionSpawnArgs> {
  const base = await prepareReflectionSpawn(input)
  const parentSessionFile = input.parentSessionFile
  if (parentSessionFile === undefined) {
    throw new Error("fork-mode reflection requires the parent session file")
  }
  // Fork mode replaces the sandboxed argv wholesale, so it must re-apply the launch prefix the
  // base spawn resolved: without it the child is the bare interpreter and dies on senpi flags.
  const args = [
    ...resolveMemoryChildLaunch(input).prefixArgs,
    "-p",
    "--fork", parentSessionFile,
    "--session-dir", base.paths.sessionDir,
    "--model", input.model,
    ...(input.thinking === undefined ? [] : ["--thinking", input.thinking]),
    `@${base.paths.prompt}`,
  ]
  return {
    ...base,
    fork: { parentSessionFile },
    args,
    cwd: input.parentCwd ?? base.cwd,
  }
}

export async function prepareFactsSpawn(input: PrepareFactsSpawnInput): Promise<FactsSpawnArgs> {
  await mkdir(input.runDir, { recursive: true, mode: 0o700 })
  const payload = join(input.runDir, "facts-payload.json")
  const extraction = join(input.runDir, "extraction.jsonl")
  try {
    await (input.chmodFile ?? chmod)(payload, 0o600)
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error
  }
  // ONE serializer, shared with the byte cap's measurement: a second stringify here would let
  // the written bytes drift past the cap the selection proved.
  await writeFile(payload, serializeFactsPayload(input.payload), { encoding: "utf8", mode: 0o600 })
  await chmod(payload, 0o400)
  const env: NodeJS.ProcessEnv = {
    ...input.env,
    FACTS_PAYLOAD_PATH: payload,
    FACTS_EXTRACTION_PATH: extraction,
    SENPI_MEMORY_FACTS: "1",
    SENPI_PTY_FORCE_PIPE: "1",
  }
  const args = [
    "-p",
    "--system-prompt", loadFactsPersona(),
    "--tools", "read,write",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--session-dir", input.runDir,
    "--model", input.model,
    ...(input.thinking === undefined ? [] : ["--thinking", input.thinking]),
    `Read ${payload} and write only ${extraction} according to the system prompt.`,
  ]
  const launch = input.senpiCommand === undefined
    ? resolveSenpiLaunch(input.env)
    : { command: input.senpiCommand, prefixArgs: input.senpiPrefixArgs ?? [] }
  return {
    runId: input.runId,
    attempt: input.attempt ?? 1,
    hardDeadlineAt: input.hardDeadlineAt ?? Date.now() + 15 * 60_000,
    model: input.model,
    ...(input.thinking === undefined ? {} : { thinking: input.thinking }),
    ...(input.nextAttempt === undefined ? {} : { nextAttempt: input.nextAttempt }),
    command: launch.command,
    args: [...launch.prefixArgs, ...args],
    cwd: input.runDir,
    env,
    detached: true,
    paths: { runDir: input.runDir, payload, extraction },
  }
}

const MEMORIAN_DEFAULT_DEADLINE_MS = 5 * 60_000

/**
 * Materialize the memorian gate child's run directory and argv.
 *
 * The argv keeps BOTH `--no-extensions` and an explicit `-e`: `--no-extensions` suppresses
 * extension DISCOVERY only, never an explicitly named extension (senpi args parsing; the same
 * combination senpi-task's RPC child spawn relies on). Dropping it would boot the parent's whole
 * extension set inside the judge. `--tools` is an allowlist that filters extension-registered
 * tools too, so `nudge` must be named there alongside `read` (the persona reads its two input
 * files). The system prompt is a FILE PATH materialized into the run dir, mirroring reflection.
 */
export async function prepareMemorianSpawn(input: PrepareMemorianSpawnInput): Promise<MemorianSpawnArgs> {
  await mkdir(input.runDir, { recursive: true, mode: 0o700 })
  const candidates = join(input.runDir, "candidates.json")
  const transcript = join(input.runDir, "transcript-window.txt")
  const persona = join(input.runDir, "memorian-persona.md")
  const extension = join(input.runDir, MEMORIAN_NUDGE_EXTENSION_FILENAME)
  const nudges = join(input.runDir, "nudges.ndjson")
  // Payload files land at 0o400, so a reused run dir must relax the mode before rewriting.
  const chmodFile = input.chmodFile ?? chmod
  const readOnlyPaths = [candidates, transcript]
  await Promise.all(readOnlyPaths.map(async (path) => {
    try {
      await chmodFile(path, 0o600)
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error
    }
  }))
  const payload = {
    version: 1,
    maxItems: input.maxItems,
    candidates: input.candidates.map((candidate) => ({
      path: candidate.path,
      description: candidate.description,
      excerpt: candidate.excerpt,
      score: candidate.score,
    })),
    surfaced: [...input.surfaced],
  }
  await Promise.all([
    writeFile(candidates, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }),
    writeFile(transcript, renderTranscriptWindow(input.transcript), { encoding: "utf8", mode: 0o600 }),
    writeFile(persona, loadMemorianPersona(), { encoding: "utf8", mode: 0o600 }),
    writeFile(extension, MEMORIAN_NUDGE_EXTENSION_SOURCE, { encoding: "utf8", mode: 0o600 }),
  ])
  await Promise.all(readOnlyPaths.map((path) => chmod(path, 0o400)))

  const env: NodeJS.ProcessEnv = {
    ...input.env,
    MEMORIAN_NUDGE_PATH: nudges,
    MEMORIAN_CANDIDATES_PATH: candidates,
    MEMORIAN_TRANSCRIPT_PATH: transcript,
    SENPI_MEMORY_MEMORIAN: "1",
    SENPI_PTY_FORCE_PIPE: "1",
  }
  const args = [
    "-p",
    "--system-prompt", persona,
    "--tools", "nudge,read",
    "-e", extension,
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--session-dir", input.runDir,
    "--model", input.model,
    ...(input.thinking === undefined ? [] : ["--thinking", input.thinking]),
    `Read ${candidates} and ${transcript}, then follow the system prompt.`,
  ]
  const launch = resolveMemoryChildLaunch(input)
  return {
    hardDeadlineAt: input.hardDeadlineAt ?? Date.now() + MEMORIAN_DEFAULT_DEADLINE_MS,
    model: input.model,
    ...(input.thinking === undefined ? {} : { thinking: input.thinking }),
    command: launch.command,
    args: [...launch.prefixArgs, ...args],
    cwd: input.runDir,
    env,
    detached: true,
    paths: { runDir: input.runDir, candidates, transcript, persona, extension, nudges },
  }
}

/** Both roles, oldest first: the judge compares what the user asked against what the agent said. */
function renderTranscriptWindow(turns: readonly { readonly role: string; readonly text: string }[]): string {
  return `${turns.map((turn) => `${turn.role}: ${turn.text}`).join("\n\n")}\n`
}

function resolveDreamTarget(worktree: string, targetDoc: string): string {
  if (isAbsolute(targetDoc) || /^[a-zA-Z]:[\\/]/.test(targetDoc) || !targetDoc.endsWith(".md")) {
    throw new TypeError("dream target must be a memory-repo-relative .md document")
  }
  const target = resolve(worktree, targetDoc)
  const confined = relative(resolve(worktree), target)
  if (!confined || confined === ".." || confined.startsWith(`..${sep}`) || isAbsolute(confined)
    || confined.split(sep).includes(".git")) {
    throw new TypeError("dream target escapes the memory worktree")
  }
  return target
}

function buildTaskPrompt(run: ReservedRun, worktree: string, transcript: string): string {
  const focus = run.request.focus ? `\nFocus: ${run.request.focus}` : ""
  const target = run.request.targetDoc === undefined
    ? []
    : [`Document maintenance target: ${run.request.targetDoc}`, "Modify no memory document except this target."]
  return [
    "# Reflection mechanics",
    `MEMORY_DIR=${worktree}`,
    `TRANSCRIPT_PATH=${transcript}`,
    "Read the transcript payload, update only files under MEMORY_DIR, and commit every intended memory change.",
    ...target,
    "Do not modify Git administration files. Finish with a clean worktree.",
    `Trigger: ${run.request.trigger}${focus}`,
  ].join("\n")
}

async function writeSystemTokenEstimate(repoDir: string, destination: string): Promise<void> {
  const estimate = await estimateSystemTokens(repoDir)
  await writeFile(destination, `${JSON.stringify({ totalTokens: estimate.totalTokens, files: estimate.files }, null, 2)}\n`, "utf8")
}

async function copyJsonOrEmpty(source: string, destination: string): Promise<void> {
  let content = "{}\n"
  try {
    content = await readFile(source, "utf8")
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error
  }
  await writeFile(destination, content, "utf8")
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

function safeRunId(runId: string): string {
  const safe = basename(runId.trim()).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  if (!safe || safe === "." || safe === "..") throw new TypeError("runId must contain a safe identifier")
  return safe.slice(0, 80)
}
