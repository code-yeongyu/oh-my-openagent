export declare const WRAPPER_DIR: string

export interface WrapperManifest {
  readonly name?: string
  readonly version?: string
  readonly bin?: Readonly<Record<string, string>>
  readonly exports?: Readonly<Record<string, string | Readonly<Record<string, string>> | undefined>>
  readonly dependencies?: Readonly<Record<string, string>>
  readonly scripts?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly bundleDependencies?: Readonly<Record<string, string>>
}

export declare function wrapperShapeRefusals(
  wrapper: WrapperManifest,
  packedPaths: readonly string[],
  payload: { readonly bin?: Readonly<Record<string, string>> },
): string[]
