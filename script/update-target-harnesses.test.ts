import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const script = readFileSync(join(import.meta.dir, "update-target-harnesses.sh"), "utf8")

describe("update-target-harnesses", () => {
  test("#given a real update #when confirmation is required #then both harnesses require an explicit phrase", () => {
    expect(script).toContain("Type UPDATE BOTH to continue")
    expect(script).toContain('[[ "$confirmation" == "UPDATE BOTH" ]]')
  })

  test("#given dry-run mode #when invoked #then it exits before downloads and updates", () => {
    const dryRunBranchStart = script.indexOf("if ((DRY_RUN)); then")
    const dryRunBranchEnd = script.indexOf("\nfi", dryRunBranchStart)
    const dryRunBranch = script.slice(dryRunBranchStart, dryRunBranchEnd)

    expect(dryRunBranchStart).toBeGreaterThan(0)
    expect(dryRunBranch).toContain("No downloads, updates, backups, builds, or tests were performed.")
    expect(dryRunBranch).toContain("exit 0")
    expect(dryRunBranch).not.toContain("npm pack")
    expect(dryRunBranch).not.toContain("omp update --force")
  })

  test("#given locally patched packages #when harnesses update #then a three-way merge is required", () => {
    expect(script).toContain("pristine $pkg@$version")
    expect(script).toContain("local installed edits")
    expect(script).toContain("updated upstream $pkg")
    expect(script).toContain('git -C "$merge_dir" merge --no-edit "$local_commit"')
    expect(script).toContain("Merge conflict in %s.")
  })

  test("#given package replacement #when trees are copied #then updated node_modules are preserved", () => {
    expect(script).toContain("clear_tree_except_node_modules")
    expect(script).toContain("--exclude='./node_modules'")
    expect(script).toContain("restore-before-update.sh")
    expect(script).toContain("Backup and recovery workspace")
  })

  test("#given successful package merges #when verification runs #then OMO is rebuilt, relinked, and checked", () => {
    expect(script).toContain('log "Running the full OMO build"')
    expect(script).toContain("bun run build")
    expect(script).toContain("bun src/cli/index.ts install-targets --target both")
    expect(script).toContain("src/host-contract")
    expect(script).toContain("bun run typecheck")
    expect(script).toContain("omo_diagnostic")
    expect(script).toContain("omo_pi_diagnostic")
  })

  test("#given model fallback configuration #when the script is stored #then no OpenRouter secret is embedded", () => {
    expect(script).toContain("openrouter/nvidia/nemotron-3-ultra-550b-a55b:free")
    expect(script).not.toContain("sk-or-v1-")
  })
})
