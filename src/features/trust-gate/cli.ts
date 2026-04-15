/**
 * CLI - Trust Gate コマンド実装
 *
 * opencode trust .        - 現在のprojectを信頼
 * opencode trust list    - 信頼済みproject一覧
 * opencode trust forget . - 信頼を削除
 */

import { Command } from "commander"
import { resolve, basename } from "node:path"
import { existsSync } from "node:fs"
import { evaluateProjectTrust, getExecutionSurfaces, shouldGateProject } from "./gate"
import { listTrustedProjects, removeTrustedProject } from "./store"
import { computeCombinedHash, hashSurfaces } from "./hash"
import { log } from "../../shared/logger"

/**
 * trustコマンドをセットアップ
 */
export function setupTrustCommand(program: Command): void {
  const trust = program
    .command("trust")
    .description("Manage trusted projects for oh-my-openagent")

  // trust . [<path>]
  trust
    .command("add [path]")
    .alias(".") // `opencode trust .` as shorthand
    .description("Approve and trust a project")
    .option("-y, --yes", "Auto-approve without prompt")
    .action(async (projectPath: string | undefined, options: { yes?: boolean }) => {
      const path = projectPath ?? "."
      const absPath = resolve(path)

      if (!existsSync(absPath)) {
        console.error(`Error: Path does not exist: ${absPath}`)
        process.exit(1)
      }

      // 実行面チェック
      const surfaces = getExecutionSurfaces(absPath)
      if (surfaces.length === 0) {
        console.log(`No execution surfaces detected in ${absPath}`)
        console.log("This project is safe to use without approval.")
        return
      }

      console.log(`Found ${surfaces.length} execution surface(s) in ${absPath}`)

      if (!options.yes) {
        console.log("\nExecution surfaces:")
        for (const s of surfaces) {
          console.log(`  [${s.type}] ${s.filePath}`)
          if (s.command) {
            console.log(`    → ${s.command.slice(0, 60)}`)
          }
        }
        console.log("")
      }

      // 承認実行
      const decision = await evaluateProjectTrust(absPath, { autoApprove: true })

      if (decision.approved) {
        console.log(`✓ Project trusted: ${basename(absPath)}`)
        console.log(`  Hash: ${decision.trustRecord?.configHash.slice(0, 16)}...`)
        console.log(`  Approved at: ${decision.trustRecord?.approvedAt}`)
      } else {
        console.error("Failed to trust project")
        process.exit(1)
      }
    })

  // trust list
  trust
    .command("list")
    .description("List all trusted projects")
    .action(() => {
      const projects = listTrustedProjects()

      if (projects.length === 0) {
        console.log("No trusted projects. Use `opencode trust .` to approve a project.")
        return
      }

      console.log(`Trusted projects (${projects.length}):\n`)
      for (const p of projects) {
        const shortHash = p.configHash.slice(0, 16)
        const date = new Date(p.approvedAt).toLocaleString()
        console.log(`  ${basename(p.absPath)}`)
        console.log(`    Path: ${p.absPath}`)
        console.log(`    Hash: ${shortHash}...`)
        console.log(`    Approved: ${date} (${p.approvedBy})`)
        console.log("")
      }
    })

  // trust forget <path>
  trust
    .command("forget <path>")
    .description("Remove a project from trusted list")
    .action((projectPath: string) => {
      const absPath = resolve(projectPath)

      const removed = removeTrustedProject(absPath)

      if (removed) {
        console.log(`✓ Removed trust for: ${absPath}`)
      } else {
        console.log(`Project not in trust list: ${absPath}`)
      }
    })

  // trust check <path>
  trust
    .command("check [path]")
    .description("Check trust status of a project")
    .action((projectPath: string | undefined) => {
      const path = projectPath ?? "."
      const absPath = resolve(path)

      if (!existsSync(absPath)) {
        console.error(`Error: Path does not exist: ${absPath}`)
        process.exit(1)
      }

      const surfaces = getExecutionSurfaces(absPath)
      const needsGate = shouldGateProject(absPath)

      if (surfaces.length === 0) {
        console.log(`Status: Safe (no execution surfaces)`)
        return
      }

      const hashed = hashSurfaces(surfaces)
      const hash = computeCombinedHash(hashed)

      console.log(`Status: ${needsGate ? "Approval required" : "Trusted"}`)
      console.log(`Hash: ${hash.slice(0, 16)}...`)
      console.log(`\nExecution surfaces (${surfaces.length}):`)

      for (const s of surfaces) {
        console.log(`  [${s.type}] ${s.filePath}`)
        if (s.command) {
          console.log(`    → ${s.command.slice(0, 60)}${s.command.length > 60 ? "..." : ""}`)
        }
      }

      if (needsGate) {
        console.log(`\nTo approve, run: opencode trust ${projectPath ?? "."}`)
      }
    })
}
