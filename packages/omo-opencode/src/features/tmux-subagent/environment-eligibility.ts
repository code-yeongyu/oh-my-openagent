import type { TmuxConfig } from "../../config/schema"
import { isInsideTmux, isTmuxPaneCompatible } from "../../shared/tmux"

export function selectTmuxManagerEnvironmentPredicate(
	isolation: TmuxConfig["isolation"],
): () => boolean {
	return isolation === "inline" ? isTmuxPaneCompatible : isInsideTmux
}
