import * as p from "@clack/prompts"
import color from "picocolors"
import { readOmoaRankings, writeOmoaRankings, getAgentRankings, setAgentRankings, hasAgentRanking } from "../state/rankings-manager"
import { readOmoaState } from "../state/state-manager"
import { resolveBestModel } from "../engine/resolver"
import { OverridableAgentNameSchema } from "../../../config/schema/agent-names"
import { loadRuntimeConfig } from "./shared"
import { getAllCachedModels } from "../models/model-cache"

export async function showRankingScreen(): Promise<void> {
  while (true) {
    const rankings = readOmoaRankings()
    const state = readOmoaState()
    const config = loadRuntimeConfig()
    const agents = (config?.agents ?? {}) as Record<string, Record<string, unknown>>

    console.log()
    console.log(color.bgBlue(color.white(color.bold(" Rankings "))))
    console.log()

    const agentNames = OverridableAgentNameSchema.options
    for (const name of agentNames) {
      const ranking = getAgentRankings(rankings, name)
      const resolved = resolveBestModel(ranking, state)
      const current = (agents[name] as { model?: string } | undefined)?.model
      const managed = hasAgentRanking(rankings, name)

      console.log(`  ${color.bold(name)}${managed ? "" : color.dim(" (no ranking)")}`)
      for (let i = 0; i < ranking.length; i++) {
        const entry = ranking[i]
        const isCurrent = entry.model === current
        const isResolved = entry.model === resolved.primary
        const marker = isCurrent ? color.green(" <- current") : isResolved && !isCurrent ? color.yellow(" <- would resolve") : ""
        console.log(`    ${color.dim(`${i + 1}.`)} ${entry.model}${marker}`)
      }
      if (ranking.length === 0) {
        console.log(`    ${color.dim("no rankings defined")}`)
      }
      console.log(`    ${color.dim("resolved:")} ${resolved.primary ?? "none"} ${color.dim(`(${resolved.primaryReason})`)}`)
      console.log()
    }

    for (const [catName, catRanking] of Object.entries(rankings.categories)) {
      if (catRanking.length === 0) continue
      console.log(`  ${color.bold(catName)} ${color.dim("[category]")}`)
      for (let i = 0; i < catRanking.length; i++) {
        console.log(`    ${color.dim(`${i + 1}.`)} ${catRanking[i].model}`)
      }
      console.log()
    }

    const action = await p.select({
      message: "Rankings actions:",
      options: [
        { value: "edit", label: "Edit agent ranking" },
        { value: "add", label: "Add model to ranking" },
        { value: "back", label: color.dim("Back to main menu") },
      ],
    })

    if (p.isCancel(action) || action === "back") return

    if (action === "edit" || action === "add") {
      const agentName = await p.select({
        message: "Select agent:",
        options: [
          ...agentNames.map((n) => ({ value: n, label: n, hint: hasAgentRanking(rankings, n) ? "has ranking" : "no ranking" })),
          { value: "__back__", label: color.dim("Cancel") },
        ],
      })

      if (p.isCancel(agentName) || agentName === "__back__") continue

      const name = agentName as string
      const current = getAgentRankings(rankings, name)

      if (action === "edit") {
        if (current.length === 0) {
          p.log.info(`No rankings for "${name}". Use "Add model to ranking" first.`)
          continue
        }

        const editAction = await p.select({
          message: `Editing rankings for "${name}":`,
          options: [
            { value: "remove", label: "Remove a model from ranking" },
            { value: "add", label: "Add model to ranking" },
            { value: "cancel", label: color.dim("Cancel") },
          ],
        })

        if (p.isCancel(editAction) || editAction === "cancel") continue

        if (editAction === "remove") {
          const toRemove = await p.select({
            message: "Select model to remove:",
            options: [
              ...current.map((e, i) => ({ value: String(i), label: e.model })),
              { value: "__cancel__", label: color.dim("Cancel") },
            ],
          })
          if (p.isCancel(toRemove) || toRemove === "__cancel__") continue

          const idx = parseInt(toRemove as string, 10)
          const removed = current[idx].model
          const updated = current.filter((_, i) => i !== idx)
          const newRankings = setAgentRankings(rankings, name, updated)
          writeOmoaRankings(newRankings)
          p.log.success(`Removed "${removed}" from ${name} rankings.`)
        }

        if (editAction === "add") {
          const model = await p.text({
            message: `Enter model to add to "${name}" ranking:`,
            placeholder: "provider/model-name",
          })
          if (p.isCancel(model)) continue
          const trimmed = (model as string).trim()
          if (!trimmed) continue

          const updated = [...current, { model: trimmed }]
          const newRankings = setAgentRankings(rankings, name, updated)
          writeOmoaRankings(newRankings)
          p.log.success(`Added "${trimmed}" to ${name} rankings.`)
        }
      }

      if (action === "add") {
        const model = await p.text({
          message: `Enter model to add to "${name}" ranking (e.g., provider/model-name):`,
          placeholder: "provider/model-name",
        })
        if (p.isCancel(model)) continue
        const trimmed = (model as string).trim()
        if (!trimmed) continue

        const updated = [...current, { model: trimmed }]
        const newRankings = setAgentRankings(rankings, name, updated)
        writeOmoaRankings(newRankings)
        p.log.success(`Added "${trimmed}" to ${name} rankings.`)
      }
    }
  }
}
