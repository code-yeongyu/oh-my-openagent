import { engineBuildIdentity } from "@code-yeongyu/senpi"

// The identity a compiled host advertises as engineVersion / engineOrdinal on its get_protocol_info and
// host ensure answers (senpi protocolIdentity reads exactly this).
console.log(JSON.stringify(engineBuildIdentity()))
