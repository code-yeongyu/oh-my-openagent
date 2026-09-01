import { composeOmoSenpiExtension } from "./compose"
import { createOmoSenpiComponents } from "./component-list"
import { createTaskComponent } from "../components/task"

export const omoSenpiComponents = createOmoSenpiComponents(createTaskComponent())

export default composeOmoSenpiExtension(omoSenpiComponents)
export { composeOmoSenpiExtension }
export type { ComponentContext, ComponentLogger, OmoSenpiComponent, SenpiExtensionAPI } from "./types"
