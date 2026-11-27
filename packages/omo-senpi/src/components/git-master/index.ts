import { existsSync } from "node:fs"
import { dirname, join } from "node:path"

import { resolveOmoGitMasterSettings, type OmoGitMasterSettings } from "@oh-my-opencode/omo-config-core"
import { GIT_SKILL_NAME } from "@oh-my-opencode/skills-loader-core/builtin-skills/skills/git-skill-metadata"
import { resolveSkillAlias } from "@oh-my-opencode/skills-loader-core/opencode-skill-loader/skill-name-aliases"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { loadSenpiOmoConfig } from "../config-resolution"
import { carriesAttributionDirective, resolveGitMasterSkillAdditions } from "./skill-content"

const SKILL_FILE_NAME = "SKILL.md"

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

function gitSkillDirName(filePath: string): string | undefined {
  const segments = filePath.replaceAll("\\", "/").split("/")
  if (segments.at(-1) !== SKILL_FILE_NAME) return undefined
  const dirName = segments.at(-2)
  return dirName !== undefined && resolveSkillAlias(dirName) === GIT_SKILL_NAME ? dirName : undefined
}

/**
 * A read of an installed skill under a retired name (`.../git-master/SKILL.md`) reads the renamed
 * skill's file when only the new directory exists. A user's own directory under the old name is
 * read as it is.
 */
function redirectRetiredSkillRead(payload: unknown): void {
  if (!isRecord(payload) || payload["type"] !== "tool_call" || payload["toolName"] !== "read") return
  const input = payload["input"]
  const filePath = readFilePath(input)
  if (!isRecord(input) || filePath === undefined) return
  const dirName = gitSkillDirName(filePath)
  if (dirName === undefined || dirName === GIT_SKILL_NAME || existsSync(filePath)) return
  const current = join(dirname(dirname(filePath)), GIT_SKILL_NAME, SKILL_FILE_NAME)
  if (!existsSync(current)) return
  input[typeof input["file_path"] === "string" ? "file_path" : "path"] = current
}

function asGitMasterReadResultEvent(payload: unknown): GitMasterReadResultEvent | undefined {
  if (!isRecord(payload) || payload["type"] !== "tool_result") return undefined
  if (payload["toolName"] !== "read" || payload["isError"] === true) return undefined
  const filePath = readFilePath(payload["input"])
  if (filePath === undefined) return undefined
  if (gitSkillDirName(filePath) === undefined) return undefined
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
      pi.on("tool_call", (payload: unknown): undefined => {
        redirectRetiredSkillRead(payload)
        return undefined
      })
      pi.on("tool_result", (payload: unknown): { content: ReadonlyArray<Record<string, unknown>> } | undefined => {
        const event = asGitMasterReadResultEvent(payload)
        if (event === undefined) return undefined
        const settings = loadSettings(pi.cwd ?? process.cwd())
        const additions = resolveGitMasterSkillAdditions(settings)
        if (additions === undefined) return undefined
        ctx.logger.info("omo-senpi git-master settings applied", {
          commitFooter: settings.commit_footer,
          includeCoAuthoredBy: settings.include_co_authored_by,
          gitEnvPrefix: settings.git_env_prefix,
        })
        const firstTextIndex = event.content.findIndex((item) => typeof item["text"] === "string")
        const content = event.content.map((item, index) =>
          index === firstTextIndex && typeof item["text"] === "string"
            ? { ...item, text: additions.rewriteSkillText(item["text"]) }
            : item,
        )
        const texts = event.content.flatMap((item) => (typeof item["text"] === "string" ? [item["text"]] : []))
        const appendDirective = additions.directive !== undefined && !carriesAttributionDirective(texts)
        return {
          content: appendDirective ? [...content, { type: "text", text: additions.directive }] : content,
        }
      })
    },
  }
}
