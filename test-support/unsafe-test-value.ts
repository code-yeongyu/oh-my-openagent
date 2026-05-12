export function unsafeTestValue<TValue extends PropertyKey>(value: TValue): TValue
export function unsafeTestValue<TValue = any>(value: unknown): TValue
export function unsafeTestValue<TValue = any>(value: unknown): TValue {
  return value as TValue
}
