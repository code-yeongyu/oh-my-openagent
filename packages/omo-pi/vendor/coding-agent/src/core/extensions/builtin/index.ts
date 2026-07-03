import type { ExtensionFactory } from "../types.ts";
import anthropicBashExtension from "./anthropic-bash/index.ts";
import anthropicWebSearchExtension from "./anthropic-web-search/index.ts";
import bashTimeoutExtension from "./bash-timeout/index.ts";
import compactionExtension from "./compaction/index.ts";
import diffExtension from "./diff.ts";
import filesExtension from "./files.ts";
import goalExtension from "./goal/index.ts";
import gptApplyPatchExtension from "./gpt-apply-patch/index.ts";
import historySearchExtension from "./history-search/index.ts";
import hooksExtension from "./hooks/index.ts";
import nestedAgentsMdExtension from "./nested-agents-md/index.ts";
import openaiWebSearchExtension from "./openai-web-search/index.ts";
import permissionSystemExtension from "./permission-system/index.ts";
import piCodexAppServerExtension from "./pi-codex-app-server/index.ts";
import promptPresetExtension from "./prompt-preset/index.ts";
import promptUrlWidgetExtension from "./prompt-url-widget.ts";
import redrawsExtension from "./redraws.ts";
import piRulesExtension from "./rules/index.ts";
import serviceTierExtension from "./service-tier.ts";
import sessionObserverExtension from "./session-observer/index.ts";
import todowriteExtension from "./todotools/index.ts";
import toolPairGuardExtension from "./tool-pair-guard/index.ts";
import tpsExtension from "./tps.ts";
import webfetchExtension from "./webfetch/index.ts";
import websearchExtension from "./websearch/index.ts";

export interface BuiltinExtensionFactory {
	id: string;
	factory: ExtensionFactory;
}

export const globalDefaultExtensionIds = ["diff", "files", "prompt-url-widget", "tps"] as const;

export const globalDefaultExtensionFactories = {
	diff: diffExtension,
	files: filesExtension,
	"prompt-url-widget": promptUrlWidgetExtension,
	tps: tpsExtension,
} satisfies Record<(typeof globalDefaultExtensionIds)[number], ExtensionFactory>;

export const builtinExtensions: BuiltinExtensionFactory[] = [
	{ id: "hooks", factory: hooksExtension },
	{ id: "permission-system", factory: permissionSystemExtension },
	{ id: "gpt-apply-patch", factory: gptApplyPatchExtension },
	{ id: "prompt-preset", factory: promptPresetExtension },
	{ id: "todowrite", factory: todowriteExtension },
	{ id: "redraws", factory: redrawsExtension },
	{ id: "anthropic-web-search", factory: anthropicWebSearchExtension },
	{ id: "anthropic-bash", factory: anthropicBashExtension },
	{ id: "openai-web-search", factory: openaiWebSearchExtension },
	{ id: "service-tier", factory: serviceTierExtension },
	{ id: "bash-timeout", factory: bashTimeoutExtension },
	{ id: "tool-pair-guard", factory: toolPairGuardExtension },
	{ id: "compaction", factory: compactionExtension },
	{ id: "history-search", factory: historySearchExtension },
	{ id: "session-observer", factory: sessionObserverExtension },
	{ id: "websearch", factory: websearchExtension },
	{ id: "webfetch", factory: webfetchExtension },
	{ id: "nested-agents-md", factory: nestedAgentsMdExtension },
	{ id: "rules", factory: piRulesExtension },
	{ id: "goal", factory: goalExtension },
	{ id: "pi-codex-app-server", factory: piCodexAppServerExtension },
];
