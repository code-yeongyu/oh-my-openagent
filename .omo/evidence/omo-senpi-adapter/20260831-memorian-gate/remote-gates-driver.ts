// Remote hermetic gates for feat/memorian-gate at branch HEAD (plan todo 9, fold-final step 4).
// Drives mengmotaMac over the bunshin mesh per fleet policy: fetch the pushed branch, add a
// namespaced temp worktree, bun install, run the four gates with full logs captured remotely, then
// MANDATORY teardown on every exit path (including throw), then pull the logs back.
// The mac's main checkout working tree is never modified: only `git fetch` + `worktree add` touch it,
// and the teardown removes the worktree and prunes.
import c from "/Users/yeongyu/local-workspaces/bunshin/packages/machine-sdk/src/index.ts"

const MAC_REPO = "/Users/yeongyu/local-workspaces/omo"
const WT = "/tmp/memorian-gate-qa-20260901"
const LOGS = "/tmp/memorian-gate-qa-20260901-logs"
const BRANCH = "feat/memorian-gate"
const EXPECTED_SHA = process.argv[3] ?? ""
const LOCAL_LOGS = process.argv[2] ?? "/tmp/memorian-gate-qa-20260901-logs"

interface Step {
  name: string
  cmd: string
  timeoutMs?: number
}

const steps: Step[] = [
  {
    name: "00-mac-main-checkout-clean-before",
    cmd: `git -C ${MAC_REPO} status --porcelain && git -C ${MAC_REPO} rev-parse HEAD`,
  },
  {
    name: "01-fetch-and-worktree",
    cmd: `git -C ${MAC_REPO} fetch origin ${BRANCH} && git -C ${MAC_REPO} worktree add ${WT} FETCH_HEAD && git -C ${WT} rev-parse HEAD && git -C ${WT} log --oneline -3`,
    timeoutMs: 300_000,
  },
  {
    name: "02-head-is-pushed-tip",
    cmd: `sha=$(git -C ${WT} rev-parse HEAD) && echo "worktree HEAD=$sha" && test "$sha" = "${EXPECTED_SHA}" && echo HEAD_MATCHES_PUSHED_TIP`,
  },
  {
    name: "03-bun-install",
    cmd: `cd ${WT} && bun install 2>&1 | tail -20`,
    timeoutMs: 1_200_000,
  },
  {
    name: "04-memory-core",
    cmd: `cd ${WT} && bun test packages/memory-core/src/`,
    timeoutMs: 1_200_000,
  },
  {
    name: "05-omo-config-core",
    cmd: `cd ${WT} && bun test packages/omo-config-core/src/`,
    timeoutMs: 1_200_000,
  },
  {
    name: "06-test-senpi",
    cmd: `cd ${WT} && bun run test:senpi`,
    timeoutMs: 2_400_000,
  },
  {
    name: "07-tsgo-omo-senpi",
    cmd: `cd ${WT} && bun x tsgo --noEmit -p packages/omo-senpi/tsconfig.json && echo TSGO_NO_DIAGNOSTICS`,
    timeoutMs: 1_200_000,
  },
]

const teardownCmd = `git -C ${MAC_REPO} worktree remove --force ${WT}; git -C ${MAC_REPO} worktree prune; if test -e ${WT}; then echo "TEARDOWN=FAILED dir-still-exists"; else echo "TEARDOWN=REMOVED"; fi; echo "--- main checkout after ---"; git -C ${MAC_REPO} status --porcelain`

const outcomes: Array<{ name: string; exit: string }> = []

async function main() {
  const m = await c.getMachine("mengmotaMac")
  await m.shell(`rm -rf ${LOGS} && mkdir -p ${LOGS}`)
  let failed = false
  try {
    for (const step of steps) {
      const run = await m.shell(
        `{ ${step.cmd}; } > ${LOGS}/${step.name}.txt 2>&1; rc=$?; tail -40 ${LOGS}/${step.name}.txt; echo "EXIT=$rc"`,
        { timeoutMs: step.timeoutMs ?? 600_000 },
      )
      const stdout = run.stdout ?? ""
      const exit = /EXIT=(\d+)/.exec(stdout)?.[1] ?? "?"
      outcomes.push({ name: step.name, exit })
      console.log(`[${step.name}] exit=${exit}`)
      console.log(stdout.slice(-4000))
      if (exit !== "0") {
        failed = true
        console.log(`!! step ${step.name} failed`)
        // 00-03 are prerequisites: without a built worktree the remaining gates are meaningless.
        // A gate failure (04+) does NOT stop the remaining gates, so one run reports every gate.
        if (/^0[0-3]-/.test(step.name)) {
          console.log("!! prerequisite failed; skipping remaining gates, going to teardown")
          break
        }
      }
    }
  } finally {
    console.log("\n=== TEARDOWN (mandatory, every exit path) ===")
    const td = await m.shell(teardownCmd, { timeoutMs: 300_000 })
    console.log(td.stdout)
    const receipt = (td.stdout ?? "").includes("TEARDOWN=REMOVED") ? "REMOVED" : "NOT-REMOVED"
    console.log(`TEARDOWN_RECEIPT=${receipt}`)
    const receiptFile = [
      `TEARDOWN=${receipt}`,
      `worktree path: ${WT}`,
      "--- git worktree list ---",
      `$(git -C ${MAC_REPO} worktree list)`,
      "--- main checkout status --porcelain ---",
      `$(git -C ${MAC_REPO} status --porcelain)`,
      "--- worktree dir presence ---",
      `$(test -e ${WT} && echo DIR_STILL_EXISTS || echo DIR_CONFIRMED_ABSENT)`,
    ].join("\n")
    await m.shell(
      `git -C ${MAC_REPO} worktree remove --force ${WT} 2>/dev/null; git -C ${MAC_REPO} worktree prune; printf '%s\n' ${JSON.stringify(receiptFile)} > ${LOGS}/99-teardown.txt; cat ${LOGS}/99-teardown.txt`,
      { timeoutMs: 300_000 },
    )
    console.log("\n=== PULLING LOGS ===")
    await m.pullTree(LOGS, LOCAL_LOGS, { clean: true })
    console.log(`pulled ${LOGS} -> ${LOCAL_LOGS}`)
    console.log(`GATE_SUMMARY=${JSON.stringify(outcomes)}`)
    await c.close()
  }
  process.exit(failed ? 1 : 0)
}

main().catch(async (error) => {
  console.error(error)
  try {
    await c.close()
  } catch {}
  process.exit(1)
})
