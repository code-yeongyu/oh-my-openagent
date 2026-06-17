import type { SupportedModel, ModelAttributes, Variant, ThinkingConfig } from "./registry";

export type FallbackModelObject = Readonly<ModelAttributes> & {
  readonly model: SupportedModel
  readonly variant?: Variant
  readonly thinking?: ThinkingConfig
}
