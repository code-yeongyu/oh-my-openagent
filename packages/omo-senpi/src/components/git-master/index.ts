import { resolveOmoGitMasterSettings, type OmoGitMasterSettings } from "@oh-my-opencode/omo-config-core"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { loadSenpiOmoConfig } from "../config-resolution"
import { buildGitMasterAttributionDirective } from "./directive"

const GIT_MASTER_SKILL_PATH_SUFFIX = "/git-master/SKILL.md"

export interface GitMasterAttributionComponentOptions {
  readonly loadSettings?: (cwd: string) => OmoGitMasterSettings
}

interface GitMasterReadResultEvent {
  readonly content: ReadonlyArray<Record<string, unknown>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readFilePath(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  const candidate = input["file_path"] ?? input["path"]
  return typeof candidate === "string" ? candidate : undefined
}

function asGitMasterReadResultEvent(payload: unknown): GitMasterReadResultEvent | undefined {
  if (!isRecord(payload) || payload["type"] !== "tool_result") return undefined
  if (payload["toolName"] !== "read" || payload["isError"] === true) return undefined
  const filePath = readFilePath(payload["input"])
  if (filePath === undefined) return undefined
  if (!filePath.replaceAll("\\", "/").endsWith(GIT_MASTER_SKILL_PATH_SUFFIX)) return undefined
  const content = payload["content"]
  if (!Array.isArray(content)) return undefined
  return { content: content.filter(isRecord) }
}

function defaultLoadSettings(cwd: string): OmoGitMasterSettings {
  return resolveOmoGitMasterSettings(loadSenpiOmoConfig({ cwd }).config)
}

export function createGitMasterAttributionComponent(
  options: GitMasterAttributionComponentOptions = {},
): OmoSenpiComponent {
  const loadSettings = options.loadSettings ?? defaultLoadSettings
  return {
    name: "git-master-attribution",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      pi.on(
        "tool_result",
        (payload: unknown): { content: ReadonlyArray<Record<string, unknown>> } | undefined => {
          const event = asGitMasterReadResultEvent(payload)
          if (event === undefined) return undefined
          const settings = loadSettings(pi.cwd ?? process.cwd())
          const directive = buildGitMasterAttributionDirective(settings)
          if (directive === undefined) return undefined
          ctx.logger.info("omo-senpi git-master attribution appended", {
            commitFooter: settings.commit_footer,
            includeCoAuthoredBy: settings.include_co_authored_by,
          })
          return { content: [...event.content, { type: "text", text: directive }] }
        },
      )
    },
  }
}
