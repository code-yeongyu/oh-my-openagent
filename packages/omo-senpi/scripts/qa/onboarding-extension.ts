import type { ExtensionAPI } from "@code-yeongyu/senpi"
import { omoSenpiComponents } from "../../src/extension"

const component = omoSenpiComponents.find((component) => component.name === "onboarding")!

export default function onboardingQaExtension(pi: ExtensionAPI): void {
  component.register(pi, {
    logger: { info() {}, warn() {}, error() {} },
    config: { getFlag: (name) => pi.getFlag(name) },
  })
}
