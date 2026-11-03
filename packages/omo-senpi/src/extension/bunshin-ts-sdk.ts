export * from "@bunshin/bunshin-ts"
export { createRelayTransport, relayStatus, RelayTransportError } from "@sisyphuslabs/bunshin-ts-relay"
export { BunshinSessionError, pickTransport } from "./bunshin-ts-pick-transport"
export { bunshin } from "./bunshin-ts-default-client"
export type * from "./bunshin-ts-pick-transport"

declare const OMO_SENPI_PACKAGE_VERSION: string
export const SDK_VERSION = typeof OMO_SENPI_PACKAGE_VERSION === "undefined" ? "dev" : OMO_SENPI_PACKAGE_VERSION
