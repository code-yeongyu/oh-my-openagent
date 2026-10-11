import type { ExtensionAPI } from "@code-yeongyu/senpi"
import { omoSenpiComponents } from "../../plugin/extensions/omo.js"

const component = omoSenpiComponents.find((component) => component.name === "onboarding")

export default function onboardingQaExtension(pi: ExtensionAPI): void {
  if (!component) throw new Error("Built onboarding component is missing")
  component.register(pi, {
    logger: { info() {}, warn() {}, error() {} },
    config: { getFlag: (name) => pi.getFlag(name) },
  })
}
