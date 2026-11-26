// The SDK runtime files' build stamp (design lane ruling on PR 15116): one value per build, written into the root and into
// every lazily loaded runtime file by the same build (plugin/scripts/build-extension-core.mjs), so the root can tell a file
// of its own build from one an update put on disk while this process ran. Run from the source tree there is no build and
// both sides read "source".
declare const OMO_SDK_RUNTIME_STAMP: string

export const RUNTIME_STAMP: string = typeof OMO_SDK_RUNTIME_STAMP === "string" ? OMO_SDK_RUNTIME_STAMP : "source"
