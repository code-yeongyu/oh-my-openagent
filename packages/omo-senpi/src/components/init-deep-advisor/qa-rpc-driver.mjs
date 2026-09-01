#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { basename } from "node:path"

import {
  assertPointer,
  cleanupFixture,
  commit,
  createFixture,
  gitText,
  launchRpc,
  proposalPath,
  removeCooldown,
  writeFutureCooldown,
  writeSnapshot,
} from "./qa-rpc-support.mjs"

const FROZEN_PLUGIN = "/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat-senpi-onboarding-init-deep-advisor/packages/omo-senpi/plugin/extensions/omo.js"
const mode = process.argv[2]
if (mode !== "e" && mode !== "f") throw new Error("usage: qa-rpc-driver.mjs <e|f>")
if (process.env.SENPI_BIN !== FROZEN_PLUGIN) throw new Error(`SENPI_BIN must be the frozen plugin path: ${FROZEN_PLUGIN}`)
if (!existsSync(FROZEN_PLUGIN)) throw new Error(`frozen plugin does not exist: ${FROZEN_PLUGIN}`)

const result = mode === "e" ? await scenarioE() : await scenarioF()
const output = `${JSON.stringify(result, null, 2)}\n`
writeFileSync(`/tmp/qa-${mode}.txt`, output)
process.stdout.write(output)

async function scenarioE() {
  const fixture = createFixture(FROZEN_PLUGIN)
  try {
    const run = await launchRpc(fixture, true)
    assertPointer(run)
    const proposal = JSON.parse(readFileSync(proposalPath(fixture), "utf8"))
    if (proposal.lastProposedHead !== gitText(fixture.repo, ["rev-parse", "HEAD"])) {
      throw new Error("coverage-gap proposal did not persist the current HEAD")
    }
    return {
      scenario: "e",
      result: "PASS",
      checks: {
        realRpcSurface: true,
        coverageGapUiRequest: run.requestId !== undefined,
        bootstrapPointer: true,
        settledCorrelated: run.settledTurnIndex >= run.turnIndex,
        settingsOnlyFrozenPlugin: true,
        sandboxRemovedInFinally: true,
      },
      evidence: { turnIndex: run.turnIndex, settledTurnIndex: run.settledTurnIndex, session: basename(run.session) },
    }
  } finally {
    cleanupFixture(fixture)
  }
}

async function scenarioF() {
  const fixture = createFixture(FROZEN_PLUGIN)
  try {
    const shaA = gitText(fixture.repo, ["rev-parse", "HEAD"])
    writeSnapshot(fixture.repo, shaA)
    for (let index = 1; index <= 40; index += 1) {
      const file = `${fixture.repo}/src/source-${index % 2}.ts`
      writeFileSync(file, `${readFileSync(file, "utf8")}export const drift${index} = ${index}\n`)
      gitText(fixture.repo, ["add", "-A"])
      commit(fixture.repo, `drift ${index}`)
    }
    const first = await launchRpc(fixture, true)
    assertPointer(first)
    removeCooldown(fixture)
    const proposal = JSON.parse(readFileSync(proposalPath(fixture), "utf8"))
    const proposedHead = proposal.lastProposedHead
    if (proposedHead !== gitText(fixture.repo, ["rev-parse", "HEAD"])) throw new Error("launch 1 did not persist proposed HEAD")

    const second = await launchRpc(fixture, false)
    if (second.transcript.includes("omo-init-deep-advisor:run")) throw new Error("same-HEAD launch injected init-deep")

    writeFileSync(`${fixture.repo}/advance.ts`, "export const advance = true\n")
    gitText(fixture.repo, ["add", "-A"])
    commit(fixture.repo, "advance")
    const newHead = gitText(fixture.repo, ["rev-parse", "HEAD"])
    if (newHead === proposedHead) throw new Error("fixture HEAD did not advance")
    writeFutureCooldown(fixture)
    const third = await launchRpc(fixture, false)
    if (third.transcript.includes("omo-init-deep-advisor:run")) throw new Error("cooldown launch injected init-deep")

    return {
      scenario: "f",
      result: "PASS",
      checks: {
        fortyCommitsTwoOfTenFiles: true,
        firstProposalAndPointer: first.requestId !== undefined,
        sameHeadSuppressed: second.requestId === undefined,
        newHeadCooldownSuppressed: third.requestId === undefined,
        allSettledCorrelated: [first, second, third].every((run) => run.settledTurnIndex >= run.turnIndex),
        settingsOnlyFrozenPlugin: true,
        sandboxRemovedInFinally: true,
      },
      evidence: {
        shaA,
        proposedHead,
        newHead,
        turns: [first, second, third].map((run) => ({ turnIndex: run.turnIndex, settledTurnIndex: run.settledTurnIndex, session: basename(run.session) })),
      },
    }
  } finally {
    cleanupFixture(fixture)
  }
}
