import type { ExtensionAPI } from "@code-yeongyu/senpi"
import { createOnboardingComponent } from "../../src/components/onboarding/component"

export default function onboardingQaExtension(pi: ExtensionAPI): void {
  createOnboardingComponent().register(pi, {
    logger: { info() {}, warn() {}, error() {} },
    config: { getFlag: (name) => pi.getFlag(name) },
  })
}
