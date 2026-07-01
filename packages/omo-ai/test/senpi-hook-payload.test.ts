import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "../../..");
const codexHooksRoot = join(repositoryRoot, "packages/omo-codex/plugin/hooks");
const senpiHooksRoot = join(repositoryRoot, "packages/omo-ai/senpi/hooks");
const matrixPath = join(
  repositoryRoot,
  "packages/omo-ai/senpi/docs/hook-migration-matrix.json",
);

const supportedSenpiEvents = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "SessionStart", "PreCompact", "PostCompact", "Stop"] as const;

const mustPortHooks = [
  "session-start-loading-project-rules.json",
  "session-start-recording-session-telemetry.json",
  "user-prompt-submit-loading-project-rules.json",
  "user-prompt-submit-checking-ultrawork-trigger.json",
  "user-prompt-submit-checking-ulw-loop-steering.json",
  "post-tool-use-checking-comments.json",
  "post-tool-use-matching-project-rules.json",
  "post-tool-use-checking-lsp-diagnostics.json",
  "post-compact-resetting-lsp-diagnostics-cache.json",
  "post-compact-resetting-project-rule-cache.json",
  "stop-checking-start-work-continuation.json",
] as const;

const subagentStopHooks = [
  "subagent-stop-checking-start-work-continuation.json",
  "subagent-stop-verifying-lazycodex-executor-evidence.json",
] as const;

const codexSourceHooks = [
  "post-compact-resetting-git-bash-mcp-reminder.json",
  "post-compact-resetting-lsp-diagnostics-cache.json",
  "post-compact-resetting-project-rule-cache.json",
  "post-tool-use-checking-codegraph-init-guidance.json",
  "post-tool-use-checking-comments.json",
  "post-tool-use-checking-lsp-diagnostics.json",
  "post-tool-use-checking-thread-title-hygiene.json",
  "post-tool-use-matching-project-rules.json",
  "pre-tool-use-enforcing-unlimited-goal-budget.json",
  "pre-tool-use-recommending-git-bash-mcp.json",
  "session-start-checking-auto-update.json",
  "session-start-checking-bootstrap-provisioning.json",
  "session-start-checking-codegraph-bootstrap.json",
  "session-start-loading-project-rules.json",
  "session-start-recording-session-telemetry.json",
  "stop-checking-start-work-continuation.json",
  "subagent-stop-checking-start-work-continuation.json",
  "subagent-stop-verifying-lazycodex-executor-evidence.json",
  "user-prompt-submit-checking-ultrawork-trigger.json",
  "user-prompt-submit-checking-ulw-loop-steering.json",
  "user-prompt-submit-loading-project-rules.json",
] as const;

const senpiHookPayloadFiles = ["omo-senpi-hooks.json"] as const;

type SupportedSenpiEvent = (typeof supportedSenpiEvents)[number];
type MigrationStatus = "ported" | "deferred" | "unsupported-v1";

type MatrixEntry = {
  readonly sourceHook: string;
  readonly status: MigrationStatus;
  readonly senpiEvent: SupportedSenpiEvent | null;
  readonly component: string | null;
  readonly command: string | null;
  readonly matcher: string | null;
  readonly reason: string;
};

type HookHandler = {
  readonly type: string;
  readonly command?: string;
};

type HookGroup = {
  readonly matcher?: string;
  readonly hooks: readonly HookHandler[];
};

type SenpiHookFile = {
  readonly hooks: Partial<Record<SupportedSenpiEvent, readonly HookGroup[]>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be a string`);
  }
  return value;
}

function requireNullableString(value: unknown, field: string): string | null {
  if (value !== null && typeof value !== "string") {
    throw new TypeError(`${field} must be null or a string`);
  }
  return value;
}

function requireStatus(value: unknown, field: string): MigrationStatus {
  if (value !== "ported" && value !== "deferred" && value !== "unsupported-v1") {
    throw new TypeError(`${field} must be a known migration status`);
  }
  return value;
}

function requireSenpiEvent(
  value: unknown,
  field: string,
): SupportedSenpiEvent | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "string" && isSupportedSenpiEvent(value)) {
    return value;
  }
  throw new TypeError(`${field} must be null or a supported senpi event`);
}

function isSupportedSenpiEvent(value: string): value is SupportedSenpiEvent {
  return supportedSenpiEvents.some((event) => event === value);
}

function readMatrix(): readonly MatrixEntry[] {
  const parsed = readJson(matrixPath);
  if (!Array.isArray(parsed)) {
    throw new TypeError("hook migration matrix must be a JSON array");
  }
  return parsed.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new TypeError(`matrix entry ${index} must be a JSON object`);
    }
    return {
      sourceHook: requireString(entry["sourceHook"], `matrix[${index}].sourceHook`),
      status: requireStatus(entry["status"], `matrix[${index}].status`),
      senpiEvent: requireSenpiEvent(entry["senpiEvent"], `matrix[${index}].senpiEvent`),
      component: requireNullableString(entry["component"], `matrix[${index}].component`),
      command: requireNullableString(entry["command"], `matrix[${index}].command`),
      matcher: requireNullableString(entry["matcher"], `matrix[${index}].matcher`),
      reason: requireString(entry["reason"], `matrix[${index}].reason`),
    } satisfies MatrixEntry;
  });
}

function readSenpiHookFiles(): readonly SenpiHookFile[] {
  if (!existsSync(senpiHooksRoot)) {
    return [];
  }
  return senpiHookPayloadFiles
    .filter((fileName) => existsSync(join(senpiHooksRoot, fileName)))
    .map((fileName) => {
      const parsed = readJson(join(senpiHooksRoot, fileName));
      if (!isRecord(parsed)) {
        throw new TypeError(`${fileName} must contain a JSON object`);
      }
      return readSenpiHookFile(parsed, fileName);
    });
}

function readSenpiHookFile(
  parsed: Record<string, unknown>,
  fileName: string,
): SenpiHookFile {
  const hooks = parsed["hooks"];
  if (!isRecord(hooks)) {
    throw new TypeError(`${fileName} must have a hooks object`);
  }
  const parsedHooks: Partial<Record<SupportedSenpiEvent, readonly HookGroup[]>> = {};
  for (const [eventName, rawGroups] of Object.entries(hooks)) {
    if (!isSupportedSenpiEvent(eventName)) {
      continue;
    }
    if (!Array.isArray(rawGroups)) {
      throw new TypeError(`${fileName}.${eventName} must be an array`);
    }
    parsedHooks[eventName] = rawGroups.map((group, groupIndex) =>
      readHookGroup(group, `${fileName}.${eventName}[${groupIndex}]`),
    );
  }
  return { hooks: parsedHooks };
}

function readHookGroup(value: unknown, field: string): HookGroup {
  if (!isRecord(value) || !Array.isArray(value["hooks"])) {
    throw new TypeError(`${field} must contain hook handlers`);
  }
  return {
    ...(typeof value["matcher"] === "string" ? { matcher: value["matcher"] } : {}),
    hooks: value["hooks"].map((handler, index) =>
      readHookHandler(handler, `${field}.hooks[${index}]`),
    ),
  };
}

function readHookHandler(value: unknown, field: string): HookHandler {
  if (!isRecord(value)) {
    throw new TypeError(`${field} must be a JSON object`);
  }
  return {
    type: requireString(value["type"], `${field}.type`),
    ...(typeof value["command"] === "string" ? { command: value["command"] } : {}),
  };
}

describe("senpi hook payload migration", () => {
  it("accounts for every Codex hook source file in the migration matrix", () => {
    // Given: the Codex hook payload is the source inventory for the Senpi payload.
    const sourceHooks = [...codexSourceHooks].sort();

    // When: the Senpi migration matrix is loaded.
    const matrix = readMatrix();
    const matrixHooks = matrix.map((entry) => entry.sourceHook).sort();

    // Then: every Codex hook appears exactly once.
    expect(sourceHooks.length).toBe(21);
    for (const hookName of sourceHooks) {
      expect(existsSync(join(codexHooksRoot, hookName))).toBe(true);
    }
    expect(matrixHooks).toEqual(sourceHooks);
    expect(new Set(matrixHooks).size).toBe(matrixHooks.length);
  });

  it("ports the required hooks only onto Senpi-supported command events", () => {
    // Given: the required migration slice is known and Senpi only supports command hooks.
    const matrixByHook = new Map(readMatrix().map((entry) => [entry.sourceHook, entry]));

    // When: each must-port hook is inspected.
    const portedEntries = mustPortHooks.map((hookName) => matrixByHook.get(hookName));

    // Then: all required hooks are ported to supported events with plugin-root command targets.
    expect(portedEntries.includes(undefined)).toBe(false);
    for (const entry of portedEntries) {
      expect(entry?.status).toBe("ported");
      expect(entry?.senpiEvent === null).toBe(false);
      expect(entry?.command).toContain("${PLUGIN_ROOT}/senpi/components/");
    }
  });

  it("keeps SubagentStop hooks unsupported without Stop emulation", () => {
    // Given: Senpi v1 does not support SubagentStop.
    const matrix = readMatrix();
    const matrixByHook = new Map(matrix.map((entry) => [entry.sourceHook, entry]));
    const hookCommands = readSenpiHookFiles()
      .flatMap((file) => Object.entries(file.hooks))
      .flatMap(([event, groups]) =>
        (groups ?? []).flatMap((group) =>
          group.hooks.map((handler) => ({ event, command: handler.command ?? "" })),
        ),
      );

    // When: the unsupported Codex SubagentStop hooks and emitted Senpi commands are inspected.
    const unsupportedEntries = subagentStopHooks.map((hookName) => matrixByHook.get(hookName));
    const stopEmulations = hookCommands.filter(
      (handler) =>
        handler.event === "Stop" &&
        (handler.command.includes("hook subagent-stop") ||
          handler.command.includes("lazycodex-executor-verify")),
    );

    // Then: the limitation is explicit and no Stop payload emulates SubagentStop behavior.
    expect(unsupportedEntries.includes(undefined)).toBe(false);
    for (const entry of unsupportedEntries) {
      expect(entry?.status).toBe("unsupported-v1");
      expect(entry?.senpiEvent).toBe(null);
      expect(entry?.reason).toContain("SubagentStop");
    }
    expect(stopEmulations).toEqual([]);
  });

  it("does not emit unsupported events in Senpi hook JSON", () => {
    // Given: Senpi hook JSON files are the payload consumed by pi package loading.
    const hookFiles = readSenpiHookFiles();

    // When: each hook event name in the payload is collected.
    const emittedEvents = hookFiles.flatMap((file) => Object.keys(file.hooks));
    const unsupportedEvents = emittedEvents.filter(
      (event) => !isSupportedSenpiEvent(event),
    );

    // Then: the payload uses only Senpi-supported hook events.
    expect(hookFiles.length > 0).toBe(true);
    expect(unsupportedEvents).toEqual([]);
  });
});
