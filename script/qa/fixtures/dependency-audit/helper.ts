import { Type } from "typebox"
import { sanitizeTerminalLabel } from "@earendil-works/pi-tui"
import { getAgentDir } from "@code-yeongyu/senpi"

export const helper = { value: 42, Type, sanitizeTerminalLabel, getAgentDir } as const
