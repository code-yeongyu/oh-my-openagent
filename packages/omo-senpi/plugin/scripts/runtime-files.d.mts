export type SdkRuntimeFile = {
  readonly name: string
  readonly entry: string
  readonly output: string
  readonly specifier: string
  readonly lazy: boolean
  readonly ceiling: number
  readonly staticSet: string
  readonly packages: readonly string[]
}

export const SDK_RUNTIME_FILES: readonly SdkRuntimeFile[]

export function runtimeArtifactPaths(table?: readonly SdkRuntimeFile[]): string[]

export const RUNTIME_IMPORT_MAP: "package.json"

export function sdkRuntimeOutputPaths(root: string, table?: readonly SdkRuntimeFile[]): Record<string, string>
