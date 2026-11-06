import { ALT, CLAUDE, GPT } from "./model-chain-answers"
import type { RunnerKind } from "./model-chain-world"

export type ChainIds = {
  readonly primary: string
  readonly second: string
  readonly parent: string
  readonly opus55: string
  /** Where senpi's shipped default chain (`claude-opus-5-5` -> `claude-opus-5:max`) lands, on another account. */
  readonly opus5: string
}

const IN_PROCESS: ChainIds = {
  primary: `${CLAUDE}/primary`,
  second: `${ALT}/rung`,
  parent: `${GPT}/parent`,
  opus55: `${CLAUDE}/claude-opus-5-5`,
  opus5: `${ALT}/claude-opus-5`,
}

const ENGINE: ChainIds = {
  primary: "deepseek/deepseek-flash",
  second: "zai/glm-5.3",
  parent: "moonshotai/kimi-k3",
  opus55: "venice/claude-opus-5-5",
  opus5: "anthropic/claude-opus-5",
}

export function chainIds(kind: RunnerKind): ChainIds {
  return kind === "in-process" ? IN_PROCESS : ENGINE
}
