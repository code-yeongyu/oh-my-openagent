import type { OmoSenpiComponent } from "../../../extension/types"
import { registerRemoteCommand } from "./command"

export function createRemoteTuiComponent(): OmoSenpiComponent {
  return {
    name: "remote",
    register(pi) {
      registerRemoteCommand(pi)
    },
  }
}
