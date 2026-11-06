import { createOmoPresenterAccountAuthority } from "../omo-opencode/src/cli/service-auth/presenter/authority"
import { serviceOrigin } from "../omo-opencode/src/cli/service-auth/protocol"

export function omoPresenterAuthority(env: Readonly<Record<string, string | undefined>>) {
  return createOmoPresenterAccountAuthority({ api: serviceOrigin(env["OMO_SERVICE_API_URL"] ?? "https://api.omo.dev") })
}
