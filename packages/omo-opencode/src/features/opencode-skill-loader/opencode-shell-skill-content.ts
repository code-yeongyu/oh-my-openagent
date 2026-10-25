import type { GitMasterConfig } from "../../config/schema"
import {
  injectGitMasterConfig as injectWithShell,
  resolveMultipleSkills as resolveMultipleWithOptions,
  resolveMultipleSkillsAsync as resolveMultipleAsyncWithOptions,
  resolveSkillContent as resolveWithOptions,
  resolveSkillContentAsync as resolveAsyncWithOptions,
  type SkillResolutionOptions,
} from "@oh-my-opencode/skills-loader-core/opencode-skill-loader/skill-content"
import type { ShellType } from "../../shared/shell-env"
import { openCodeShellTypeResolver } from "../../shared/opencode-shell"

function withOpenCodeShell(options?: SkillResolutionOptions): SkillResolutionOptions {
  return { ...options, shellType: options?.shellType ?? openCodeShellTypeResolver.resolveShellType() }
}

export function injectGitMasterConfig(template: string, config?: GitMasterConfig, shellType?: ShellType): string {
  return injectWithShell(template, config, shellType ?? openCodeShellTypeResolver.resolveShellType())
}

export function resolveSkillContent(skillName: string, options?: SkillResolutionOptions): string | null {
  return resolveWithOptions(skillName, withOpenCodeShell(options))
}

export function resolveMultipleSkills(skillNames: string[], options?: SkillResolutionOptions): ReturnType<typeof resolveMultipleWithOptions> {
  return resolveMultipleWithOptions(skillNames, withOpenCodeShell(options))
}

export function resolveSkillContentAsync(skillName: string, options?: SkillResolutionOptions): Promise<string | null> {
  return resolveAsyncWithOptions(skillName, withOpenCodeShell(options))
}

export function resolveMultipleSkillsAsync(
  skillNames: string[],
  options?: SkillResolutionOptions,
): ReturnType<typeof resolveMultipleAsyncWithOptions> {
  return resolveMultipleAsyncWithOptions(skillNames, withOpenCodeShell(options))
}
