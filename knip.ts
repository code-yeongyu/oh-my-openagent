import { fileURLToPath } from "node:url"
import { composeKnipConfig } from "./script/knip-config.ts"

// knip's configuration lives with the directories it describes: knip.base.jsonc plus one knip.workspace.jsonc per
// directory (script/knip-config.ts). Add a workspace, an entry or a pre-existing export row in your own directory's file.
export default composeKnipConfig(fileURLToPath(new URL(".", import.meta.url)))
