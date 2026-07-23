import type { TmuxConfig } from "../../config/schema"
import { isNativeTmux, isTmuxPaneCompatible } from "../../shared/tmux"

export function selectTmuxManagerEnvironmentPredicate(
	isolation: TmuxConfig["isolation"],
): () => boolean {
	return isolation === "inline" ? isTmuxPaneCompatible : isNativeTmux
}
