import type { IdentifiedInput } from "../input-effects"
import type { HostSessionCommand } from "./session-client"

export function toHostInput(command: IdentifiedInput): HostSessionCommand {
  switch (command.type) {
    case "follow_up": return { ...command, type: "followUp" }
    case "prompt": return { ...command, type: "prompt" }
    case "steer": return { ...command, type: "steer" }
  }
}
