import { RUNTIME_BUILD_INFO } from "../generated/runtime-build-info"

export function getRuntimeBuildInfo(): { build_id: string; build_timestamp: string } {
  return {
    build_id: RUNTIME_BUILD_INFO.buildId,
    build_timestamp: RUNTIME_BUILD_INFO.buildTimestamp,
  }
}
