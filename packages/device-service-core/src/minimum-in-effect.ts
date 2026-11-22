/** The test-only override of the two omo#13037 minimum service versions (connectDeviceService's `minimums`). */
export type MinimumsOption = { readonly wakeMark: string | null; readonly singleLocate: string | null }

/**
 * The minimum service version in effect: the shipped constant when no override is given, else the override's value,
 * where null means "unset" (no service qualifies), also once the shipped constant has a value.
 */
export const minimumInEffect = (
  option: MinimumsOption | undefined,
  key: keyof MinimumsOption,
  shipped: string | null,
): string | null => (option === undefined ? shipped : option[key])
