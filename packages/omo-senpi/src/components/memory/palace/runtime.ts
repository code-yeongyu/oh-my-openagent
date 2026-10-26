// Sidecar entry for /palace and /people, bundled as extensions/omo-memory-palace.js and imported
// through `#omo-memory-palace-runtime` on first use (see runtime-loader.ts).

export { runPalaceCommand } from "./command-runtime"
export { runPeopleCommand } from "../commands/people-runtime"
