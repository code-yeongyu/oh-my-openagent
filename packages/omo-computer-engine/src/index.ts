import { packageName as protocolPackageName } from "@oh-my-opencode/omo-computer-protocol"

/** Locator, checksum and signature trust, stable-path launch and bunshin descriptor of the omo-computer-engine binary. */
export const packageName = "@oh-my-opencode/omo-computer-engine" as const

/** The packages this one depends on, exactly the edges of the architecture table. */
export const dependencyPackageNames = [protocolPackageName] as const

export { engineHost, libcFromSignals, type EngineLibc } from "./host.ts"
export { ENGINE_CHECKSUMS_ASSET, ENGINE_RELEASE_HOSTS, releaseAssetName } from "./release-assets.ts"
export { locateEngine, type EngineLocation, type EngineOrigin, type LocatorOptions } from "./locator.ts"
export { verifyDesignatedRequirement, type CodesignRunner } from "./trust.ts"
export { EngineLaunchRefused, type EngineLaunchRefusalReason } from "./refusal.ts"
export { LaunchRefusalReader, type LaunchContextRefusal } from "./launch-refusal.ts"
export { createLaunch, type Launch, type LaunchedEngine, type LaunchOptions, type SpawnEngine } from "./launch.ts"
