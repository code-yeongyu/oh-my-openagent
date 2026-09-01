import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Bundlers inline this module, so import.meta.url points at the consuming bundle, and the
// distance to the skills directory depends on where that bundle landed:
//   dist/index.js            -> dist/skills            (sibling)
//   dist/cli/index.js        -> dist/skills            (parent)
//   dist/cli-node/index.js   -> dist/skills            (parent)
//   plugins/omo/dist/cli/    -> plugins/omo/skills     (grandparent; the Codex marketplace
//                                                       layout, where `plugin/` is copied to
//                                                       `plugins/omo/` and the root CLI
//                                                       runtimes are bundled into
//                                                       `plugins/omo/dist/cli`)
// Probes run nearest-first so a closer skills directory always wins, and the sibling path is
// returned unchanged when nothing matches, keeping the previous not-found behavior.
const SKILLS_PROBE_SPECIFIERS = ["./skills/", "../skills/", "../../skills/"];

export function sharedSkillsRootPath() {
	const candidates = SKILLS_PROBE_SPECIFIERS.map((specifier) =>
		fileURLToPath(new URL(specifier, import.meta.url)),
	);
	return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}
