import type { ExtensionAPI } from "@code-yeongyu/senpi"
import { omoSenpiComponents } from "../../plugin/extensions/omo.js"

const component = omoSenpiComponents.find((component) => component.name === "claim-receipt")

export default function claimReceiptQaExtension(pi: ExtensionAPI): void {
  if (!component) throw new Error("Built claim-receipt component is missing")
  component.register(pi, {
    logger: { info() {}, warn() {}, error() {} },
    config: { getFlag: (name) => pi.getFlag(name) },
  })
}
