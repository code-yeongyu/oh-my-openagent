import { describe, expect, test } from "bun:test"

import { createProductIdentity } from "./product-identity"

describe("#given a product identity config", () => {
  test("#when accepted package names are omitted #then package and plugin names are derived in order", () => {
    const identity = createProductIdentity({
      pluginName: "canonical-plugin",
      legacyPluginName: "legacy-plugin",
      publishedPackageName: "published-package",
      configBasename: "canonical-config",
      legacyConfigBasename: "legacy-config",
      logFileName: "product.log",
      cacheDirName: "product-cache",
    })

    expect(identity.acceptedPackageNames).toEqual(["published-package", "canonical-plugin"])
  })

  test("#when accepted package names are supplied #then the supplied order is preserved", () => {
    const identity = createProductIdentity({
      pluginName: "canonical-plugin",
      legacyPluginName: "legacy-plugin",
      publishedPackageName: "published-package",
      acceptedPackageNames: ["legacy-plugin", "published-package", "canonical-plugin"],
      configBasename: "canonical-config",
      legacyConfigBasename: "legacy-config",
      logFileName: "product.log",
      cacheDirName: "product-cache",
    })

    expect(identity.acceptedPackageNames).toEqual(["legacy-plugin", "published-package", "canonical-plugin"])
  })
})
