import { createLazyRemoteSurface } from "../../remote/port/lazy-remote"
import type { RemoteSender } from "../../remote/types"
import type { AliasRegistry, RemoteThreadSurface } from "./ports"

type SignIn = {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly cwd: string
  readonly log?: (line: string) => void
}

/** The account's alias registry over the CLI sign-in, from the thread client and device-account sidecars. */
export async function loadServiceAliasRegistry(signIn: SignIn): Promise<AliasRegistry> {
  const [{ createServiceAliasRegistry }, { cliServiceAccess }] = await Promise.all([
    import("#omo-thread-client-runtime"),
    import("#omo-device-account-runtime"),
  ])
  return createServiceAliasRegistry(cliServiceAccess(signIn))
}

/**
 * The account surface of a thread SDK whose caller passed none (#14616): this device's device service and the account's
 * alias registry, each loaded from the plugin's sidecars on its first use, so a script that only reads this device's
 * threads loads neither. Without it a script saw only its own daemon and read another device's live thread as not_found.
 */
export function createAccountRemoteSurface(
  options: SignIn & { readonly version: string; readonly sender: RemoteSender },
): RemoteThreadSurface {
  const { version, sender, ...signIn } = options
  return createLazyRemoteSurface({
    version,
    sender,
    loadRuntime: () => import("#omo-thread-client-runtime"),
    loadAliasRegistry: () => loadServiceAliasRegistry(signIn),
  })
}
