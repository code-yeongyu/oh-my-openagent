import type { RefusalText } from "../refusal-texts"

/** The thread controls's refusal templates (control.*), composed into the one registry (`refusal-texts.ts`). */
export const CONTROL_TEXTS = {} as const satisfies Readonly<Record<`control.${string}`, RefusalText>>
