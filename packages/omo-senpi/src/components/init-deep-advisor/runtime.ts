import { execFileSync } from "node:child_process"

import type { ExtensionContext } from "@code-yeongyu/senpi"

import type { SenpiExtensionAPI } from "../../extension/types"
import { getBuiltinSkillsRoot } from "../telemetry/product-identity"
import { computeEligibility } from "./eligibility"
import { gitHead } from "./git-helpers"
import { buildProposedData } from "./proposed-data"
import type { EligibilityResult, SuggestedMode } from "./proposed-data"
import {
  isGloballyDeclined,
  isProjectDeclined,
  readCooldownUntil,
  readLastProposedHead,
  repoHash,
  writeCooldown,
  writeGlobalDecline,
  writeLastProposedHead,
  writeProjectDecline,
} from "./state"

const CHOICES = [
  "Run now",
  "Skip this time",
  "Never in this project",
  "Never anywhere",
] as const

export interface AdvisorPreflight {
  readonly root: string
  readonly stateDir: string
}

export async function runAdvisorAfterPreflight(
  pi: SenpiExtensionAPI,
  eventCtx: ExtensionContext,
  preflight: AdvisorPreflight,
): Promise<void> {
  const { root, stateDir } = preflight
  const repo = repoHash(root)
  if (isGloballyDeclined(stateDir)) return
  if (isProjectDeclined(stateDir, repo)) return
  const cooldownUntil = readCooldownUntil(stateDir, repo)
  if (Date.now() < cooldownUntil) return
  const currentHead = gitHead(root)
  const eligibility = computeEligibility(
    root,
    currentHead,
    readLastProposedHead(stateDir, repo),
    cooldownUntil,
  )
  if (eligibility === null) return
  writeLastProposedHead(stateDir, repo, currentHead)
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  const choice = await eventCtx.ui?.select("Init-deep", [...CHOICES], { timeout: 60_000 })
  handleChoice(choice, pi, stateDir, repo, root, eligibility)
}

function handleChoice(
  choice: string | undefined,
  pi: SenpiExtensionAPI,
  stateDir: string,
  repo: string,
  root: string,
  eligibility: EligibilityResult,
): void {
  if (choice === "Run now") {
    const skillsRoot = getBuiltinSkillsRoot()
    pi.sendMessage(
      {
        customType: "omo-init-deep-advisor:run",
        content: `Read the init-deep skill at ${skillsRoot}/init-deep/SKILL.md with the read tool and follow it.`,
        display: false,
      },
      { triggerTurn: true, deliverAs: "followUp" },
    )
    pi.appendEntry?.(
      "omo-init-deep-advisor:proposed",
      buildProposedData(repo, eligibility, suggestedMode(root)),
    )
    return
  }
  if (choice === "Skip this time" || choice === undefined) {
    writeCooldown(stateDir, repo, Date.now())
    return
  }
  if (choice === "Never in this project") {
    writeProjectDecline(stateDir, repo)
    return
  }
  if (choice === "Never anywhere") writeGlobalDecline(stateDir)
}

function suggestedMode(root: string): SuggestedMode {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "AGENTS.md"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return "committed"
  } catch {
    return "local"
  }
}
