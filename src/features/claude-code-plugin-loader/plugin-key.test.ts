import { describe, expect, it } from "bun:test"

import { derivePluginNameFromKey } from "./plugin-key"

describe("derivePluginNameFromKey", () => {
  it("#given an invalid file URL plugin key #when deriving the plugin name #then it falls back to basename", () => {
    // given
    const pluginKey = "file://%zz/broken-plugin@1.0.0"

    // when
    const name = derivePluginNameFromKey(pluginKey)

    // then
    expect(name).toBe("broken-plugin")
  })
})
