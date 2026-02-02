import type { BuiltinSkill } from "./types"
import type { BrowserAutomationProvider } from "../../config/schema"

import {
  playwrightSkill,
  agentBrowserSkill,
  frontendUiUxSkill,
  gitMasterSkill,
  devBrowserSkill,
} from "./skills/index"

export interface CreateBuiltinSkillsOptions {
  browserProvider?: BrowserAutomationProvider
}

export function createBuiltinSkills(options: CreateBuiltinSkillsOptions = {}): BuiltinSkill[] {
  const { browserProvider = "playwright" } = options

  const browserSkill = browserProvider === "agent-browser" ? agentBrowserSkill : playwrightSkill

  return [browserSkill, frontendUiUxSkill, gitMasterSkill, devBrowserSkill]
}
