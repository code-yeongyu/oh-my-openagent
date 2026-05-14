export { discoverRoles } from "./discover"
export { buildViews } from "./view"
export { renderPanel } from "./renderer"
export {
  setOverride,
  clearOverride,
  getOverride,
  tryConsumeBudget,
  getBudgetSpent,
  setAutoPick,
  getAutoPickOverride,
  resetSession,
} from "./state"
export {
  isRolesModelsCommand,
  handleRolesModelsCommand,
  maybeAutoPrintPanel,
  resolveAutoPick,
} from "./command-handler"
export { parseProviderModel, resolveOverrideModel } from "./active-model"
export type { ProviderModel } from "./active-model"
export type { ChainEntry, Role, RoleView, ActiveReason } from "./types"
export type { RenderOptions } from "./renderer"
export type { BuildViewsOptions } from "./view"
