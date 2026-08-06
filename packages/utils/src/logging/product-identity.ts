export type ProductIdentityInput = {
  readonly pluginName: string
  readonly legacyPluginName: string
  readonly publishedPackageName: string
  readonly configBasename: string
  readonly legacyConfigBasename: string
  readonly logFileName: string
  readonly cacheDirName: string
  readonly acceptedPackageNames?: readonly string[]
}

export type ProductIdentity = {
  readonly pluginName: string
  readonly legacyPluginName: string
  readonly publishedPackageName: string
  readonly acceptedPackageNames: readonly string[]
  readonly configBasename: string
  readonly legacyConfigBasename: string
  readonly logFileName: string
  readonly cacheDirName: string
}

export function createProductIdentity(input: ProductIdentityInput): ProductIdentity {
  return {
    pluginName: input.pluginName,
    legacyPluginName: input.legacyPluginName,
    publishedPackageName: input.publishedPackageName,
    acceptedPackageNames: input.acceptedPackageNames ?? [input.publishedPackageName, input.pluginName],
    configBasename: input.configBasename,
    legacyConfigBasename: input.legacyConfigBasename,
    logFileName: input.logFileName,
    cacheDirName: input.cacheDirName,
  }
}
