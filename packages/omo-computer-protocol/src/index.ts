/** Generated wire types, call-chain classifier and schema-drift test of the computer-use v3 engine. */
export const packageName = "@oh-my-opencode/omo-computer-protocol" as const

/** The packages this one depends on, exactly the edges of the architecture table. */
export const dependencyPackageNames = [] as const

export { type CallStep, type ChainVerdict, classifyCallChain, resolveOneshot } from "./call-chain.ts"
export * from "./engine-schema.generated.ts"
