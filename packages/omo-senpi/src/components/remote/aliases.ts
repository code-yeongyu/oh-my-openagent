import type { ClientCore, RemoteClient } from "./client"
import { remoteFailure } from "./codes"
import type { RemoteFailure } from "./types"

// The account's alias registry (thread/remote/alias-registry.ts `createServiceAliasRegistry`) needs a `ServiceAccess`:
// the account service's origin and a refreshing bearer token. Its only constructor today is the CLI sign-in
// (`cliServiceAccess`, #omo-device-account-runtime), which pulls the device-service-core barrel and the service-auth
// keystore into the graph, and the person client must not. `ClientCore.deps` carries no access or registry, so until it
// does every alias member answers this, as data.
const noServiceAccess = (): RemoteFailure =>
  remoteFailure(
    "unsupported",
    "This client was built without access to the account's alias registry.",
    "Address the thread by its id or name with sessions.resolve.",
    { details: { feature: "aliases", missing: "service_access" } },
  )

/** The alias members (unit U3 of #13414, design 4b): resolve, set and clear on the account's alias registry. */
export function aliasMembers(_core: ClientCore): RemoteClient["aliases"] {
  return {
    resolve: async () => noServiceAccess(),
    set: async () => noServiceAccess(),
    clear: async () => noServiceAccess(),
  }
}
