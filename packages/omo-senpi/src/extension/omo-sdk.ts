export * from "../components/omo-sdk"

declare const OMO_SENPI_PACKAGE_VERSION: string
export const SDK_VERSION = typeof OMO_SENPI_PACKAGE_VERSION === "undefined" ? "dev" : OMO_SENPI_PACKAGE_VERSION
