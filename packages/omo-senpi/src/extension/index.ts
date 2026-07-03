import { composeOmoSenpiExtension } from "./compose"
import type { OmoSenpiComponent } from "./types"

const components: OmoSenpiComponent[] = []

export default composeOmoSenpiExtension(components)
export { composeOmoSenpiExtension }
export type { ComponentContext, ComponentLogger, OmoSenpiComponent, SenpiExtensionAPI } from "./types"
