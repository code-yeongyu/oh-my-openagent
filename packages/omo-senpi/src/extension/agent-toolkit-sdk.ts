import { omoSenpiPackageVersion } from "../package-version"

export { agentToolkit } from "../components/ulw-loop/sdk/session-toolkit"
export { toolkitContextFromEnv } from "../components/ulw-loop/sdk/session-binding"
export {
  createAgentToolkit,
  ULW_LOOP_MANIFEST,
  ULW_LOOP_OPERATIONS,
} from "../../../omo-codex/plugin/components/ulw-loop/src/sdk.js"
export type * from "../../../omo-codex/plugin/components/ulw-loop/src/sdk.js"
export type * from "../components/ulw-loop/sdk/session-binding"
export type * from "../components/ulw-loop/sdk/session-toolkit"

export const SDK_VERSION = omoSenpiPackageVersion()
