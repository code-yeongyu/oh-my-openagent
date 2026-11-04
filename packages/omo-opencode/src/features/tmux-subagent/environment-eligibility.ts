import type { MultiplexerBackend } from "@oh-my-opencode/tmux-core"
import { isHerdrBinaryCallable } from "@oh-my-opencode/tmux-core"
import type { TmuxConfig } from "../../config/schema"
import { isNativeTmux, isTmuxPaneCompatible } from "../../shared/tmux"

/**
 * Predicate injected as the manager's `isInsideTmux` dep (the environment
 * eligibility gate). On the herdr backend subagent panes do not require tmux
 * at all - the gate becomes herdr binary presence, so omo can render
 * subagents into herdr from any terminal. Default (tmux) behavior is
 * unchanged.
 */
export function selectTmuxManagerEnvironmentPredicate(
	isolation: TmuxConfig["isolation"],
	multiplexer: MultiplexerBackend = "tmux",
): () => boolean {
	if (multiplexer === "herdr") return () => isHerdrBinaryCallable()
	return isolation === "inline" ? isTmuxPaneCompatible : isNativeTmux
}
