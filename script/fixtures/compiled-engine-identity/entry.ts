import { engineBuildIdentity } from "@code-yeongyu/senpi"

// Senpi's protocol identity uses this same value for engineVersion and engineOrdinal.
console.log(JSON.stringify(engineBuildIdentity()))
