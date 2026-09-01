// Cold-boot probe for the pi-tui warm-up in composeOmoSenpiExtension.
//
// Executed by compose-cold-pi-tui.test.ts in a FRESH bun process on purpose: both bunfig test
// preloads (root test-setup.ts and packages/senpi-task/test-support/warm-lazy-runtime.ts) call
// loadPiTui() before any test body runs, so a probe living inside the test process would pass no
// matter what compose does. `bun run` ignores `[test] preload`, so this file boots with the pi-tui
// boundary genuinely cold, then prints one JSON line the test parses.
//
// The scenario is the shipped `--omo-senpi-task-disabled` flag: the task component never registers,
// so any warm-up that lives inside its register() is skipped, and the OTHER components' renderers
// (here fallback-architect's notice, same buildNoticeBox path the memory worker entry renderers
// use) must still render.
import { createTaskComponent } from "../../components/task"
import { renderFallbackArchitectNotice } from "../../components/fallback-architect/notice"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeOmoSenpiExtension } from "../compose"
import type { ComponentLogger } from "../types"

type ProbeResult = {
  readonly coldBeforeCompose: boolean
  readonly rendered: boolean
  readonly error?: string
}

const silentLogger: ComponentLogger = { info: () => {}, warn: () => {}, error: () => {} }

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
} as unknown as Parameters<typeof renderFallbackArchitectNotice>[2]

function renderNotice(): unknown {
  return renderFallbackArchitectNotice(
    { details: { from: "anthropic/claude-fable-5", to: "zai/glm-5" } } as Parameters<typeof renderFallbackArchitectNotice>[0],
    { expanded: false } as Parameters<typeof renderFallbackArchitectNotice>[1],
    theme,
  )
}

async function main(): Promise<ProbeResult> {
  // Proves the process really started cold; without this the "rendered" assertion could be
  // satisfied by an unnoticed preload rather than by compose's warm-up. Rendering is the same
  // buildNoticeBox -> piTui() path exercised after compose, so a cold boundary throws here.
  let coldBeforeCompose = false
  try {
    renderNotice()
  } catch {
    coldBeforeCompose = true
  }

  const pi = new FakeExtensionAPI()
  const baseGetFlag = pi.getFlag.bind(pi)
  pi.getFlag = (name: string) => (name === "omo-senpi-task-disabled" ? true : baseGetFlag(name))

  await composeOmoSenpiExtension([createTaskComponent()], { logger: silentLogger })(pi)

  try {
    return { coldBeforeCompose, rendered: renderNotice() !== undefined }
  } catch (error) {
    return { coldBeforeCompose, rendered: false, error: error instanceof Error ? error.message : String(error) }
  }
}

console.log(JSON.stringify(await main()))
