import { ALT, CLAUDE, GPT } from "./model-chain-answers"
import type { RunnerKind } from "./model-chain-world"

export type ChainIds = {
  readonly primary: string
  readonly second: string
  readonly parent: string
  readonly opus55: string
  /** Where senpi's shipped default chain for `claude-opus-5-5` lands first (`claude-fable-5-2`), on another account. */
  readonly shippedRung: string
}

const IN_PROCESS: ChainIds = {
  primary: `${CLAUDE}/primary`,
  second: `${ALT}/rung`,
  parent: `${GPT}/parent`,
  opus55: `${CLAUDE}/claude-opus-5-5`,
  shippedRung: `${ALT}/claude-fable-5-2`,
}

const ENGINE: ChainIds = {
  primary: "deepseek/deepseek-flash",
  second: "zai/glm-5.3",
  parent: "moonshotai/kimi-k3",
  opus55: "venice/claude-opus-5-5",
  shippedRung: "anthropic/claude-fable-5-2",
}

export function chainIds(kind: RunnerKind): ChainIds {
  return kind === "in-process" ? IN_PROCESS : ENGINE
}
