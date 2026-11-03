// Sidecar entry for the signed-in device account (the service-auth credential store, session refresh and
// account read), bundled as extensions/omo-device-account.js and imported through
// `#omo-device-account-runtime` on the first memory sync resolve (see account-runtime-loader.ts).

export { createCliAccountSource } from "./account-source"
