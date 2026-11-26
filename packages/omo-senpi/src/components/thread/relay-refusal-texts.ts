import type { RefusalText } from "./refusal-texts"

/** The relay transport's refusal templates (relay.*), composed into the one registry (`refusal-texts.ts`). */
export const RELAY_TEXTS = {} as const satisfies Readonly<Record<`relay.${string}`, RefusalText>>
