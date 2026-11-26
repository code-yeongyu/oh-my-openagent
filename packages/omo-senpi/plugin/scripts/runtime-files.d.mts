export type SdkRuntimeFile = {
  readonly name: string
  readonly entry: string
  readonly output: string
  readonly specifier: string
  readonly lazy: boolean
}

export const SDK_RUNTIME_FILES: readonly SdkRuntimeFile[]

export function runtimeArtifactPaths(table?: readonly SdkRuntimeFile[]): string[]
