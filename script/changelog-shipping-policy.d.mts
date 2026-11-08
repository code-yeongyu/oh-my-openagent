export type ShippingPolicy = {
  readonly packages: readonly { readonly directory: string; readonly manifest: Record<string, unknown> }[]
  readonly generators: ReadonlySet<string>
  readonly crates: readonly string[]
}

export function isTestOrGeneratedPath(path: string): boolean
export function isUserFacingPath(path: string, policy: ShippingPolicy): boolean
export function shippingPolicy(paths: readonly string[], read: (path: string) => string): ShippingPolicy
