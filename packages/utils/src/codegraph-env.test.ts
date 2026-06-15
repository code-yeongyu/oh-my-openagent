import { describe, expect, it } from "bun:test"
import { join } from "node:path"

import {
  CODEGRAPH_INSTALL_DIR_ENV,
  CODEGRAPH_NO_DOWNLOAD_ENV,
  CODEGRAPH_TELEMETRY_ENV,
  DO_NOT_TRACK_ENV,
  buildCodegraphEnv,
} from "./codegraph/env"

describe("buildCodegraphEnv", () => {
  it("forces telemetry off and scopes the CodeGraph install cache under ~/.omo/codegraph", () => {
    // given
    const homeDir = "/Users/alice"

    // when
    const result = buildCodegraphEnv({ homeDir })

    // then
    expect(result).toEqual({
      [CODEGRAPH_INSTALL_DIR_ENV]: join(homeDir, ".omo", "codegraph"),
      [CODEGRAPH_NO_DOWNLOAD_ENV]: "1",
      [CODEGRAPH_TELEMETRY_ENV]: "0",
      [DO_NOT_TRACK_ENV]: "1",
    })
    expect("CODEGRAPH_DIR" in result).toBe(false)
  })
})
