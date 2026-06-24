import { homedir } from "node:os"
import { join } from "node:path"

export const CODEGRAPH_INSTALL_DIR_ENV = "CODEGRAPH_INSTALL_DIR"
export const CODEGRAPH_NO_DOWNLOAD_ENV = "CODEGRAPH_NO_DOWNLOAD"
export const CODEGRAPH_TELEMETRY_ENV = "CODEGRAPH_TELEMETRY"
export const DO_NOT_TRACK_ENV = "DO_NOT_TRACK"

export interface BuildCodegraphEnvOptions {
  readonly homeDir?: string
}

export type CodegraphEnv = {
  readonly [CODEGRAPH_INSTALL_DIR_ENV]: string
  readonly [CODEGRAPH_NO_DOWNLOAD_ENV]: "1"
  readonly [CODEGRAPH_TELEMETRY_ENV]: "0"
  readonly [DO_NOT_TRACK_ENV]: "1"
}

export function buildCodegraphEnv(options: BuildCodegraphEnvOptions = {}): CodegraphEnv {
  const homeDir = options.homeDir ?? homedir()

  return {
    [CODEGRAPH_INSTALL_DIR_ENV]: join(homeDir, ".omo", "codegraph"),
    [CODEGRAPH_NO_DOWNLOAD_ENV]: "1",
    [CODEGRAPH_TELEMETRY_ENV]: "0",
    [DO_NOT_TRACK_ENV]: "1",
  }
}
