import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"

import { createCodeGraphContextConfig } from "./code-graph-context"

describe("createCodeGraphContextConfig", () => {
  describe("#given config is undefined or disabled", () => {
    test("#when config is undefined #then returns undefined", () => {
      // when
      const result = createCodeGraphContextConfig(undefined)

      // then
      expect(result).toBeUndefined()
    })

    test("#when enabled is false #then returns undefined", () => {
      // when
      const result = createCodeGraphContextConfig({ enabled: false })

      // then
      expect(result).toBeUndefined()
    })
  })

  describe("#given config is enabled", () => {
    test("#when binary_path points to nonexistent file #then returns undefined", () => {
      // given
      const config = { enabled: true, binary_path: "/nonexistent/path/to/cgc" }

      // when
      const result = createCodeGraphContextConfig(config)

      // then
      expect(result).toBeUndefined()
    })

    test("#when binary_path points to existing file #then returns local MCP config", () => {
      // given - use bun binary as a stand-in for an existing executable
      const existingBinary = process.execPath
      const config = { enabled: true, binary_path: existingBinary }

      // when
      const result = createCodeGraphContextConfig(config)

      // then
      expect(result).toBeDefined()
      expect(result!.type).toBe("local")
      expect(result!.command).toEqual([existingBinary, "mcp", "start"])
      expect(result!.enabled).toBe(true)
    })

    test("#when binary found #then environment uses ~/.codegraphcontext paths", () => {
      // given
      const existingBinary = process.execPath
      const config = { enabled: true, binary_path: existingBinary }

      // when
      const result = createCodeGraphContextConfig(config)

      // then
      const cgcDir = join(homedir(), ".codegraphcontext")
      expect(result!.environment.FALKORDB_PATH).toBe(join(cgcDir, "falkordb.db"))
      expect(result!.environment.LOG_FILE_PATH).toBe(join(cgcDir, "logs", "cgc.log"))
      expect(result!.environment.DEFAULT_DATABASE).toBe("falkordb")
      expect(result!.environment.CACHE_ENABLED).toBe("true")
    })
  })
})
