import type { RefusalText } from "../refusal-texts"

/** The address resolver's refusal templates (address.*), composed into the one registry (`refusal-texts.ts`). */
export const ADDRESS_TEXTS = {} as const satisfies Readonly<Record<`address.${string}`, RefusalText>>
