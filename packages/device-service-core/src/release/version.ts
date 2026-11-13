const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export const isSemver = (value: string): boolean => SEMVER.test(value)

const compareIdentifier = (a: string, b: string): number => {
  const numericA = /^\d+$/.test(a)
  const numericB = /^\d+$/.test(b)
  if (numericA && numericB) return Math.sign(Number(a) - Number(b))
  if (numericA !== numericB) return numericA ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Semantic-version precedence of two valid versions: negative, zero or positive. Build metadata is ignored. */
export const compareVersions = (a: string, b: string): number => {
  const left = SEMVER.exec(a)
  const right = SEMVER.exec(b)
  if (left === null || right === null) throw new Error(`not a semantic version: ${left === null ? a : b}`)
  for (const index of [1, 2, 3]) {
    const difference = Number(left[index]) - Number(right[index])
    if (difference !== 0) return Math.sign(difference)
  }
  const preLeft = left[4]?.split(".") ?? []
  const preRight = right[4]?.split(".") ?? []
  if (preLeft.length === 0 || preRight.length === 0) return Math.sign(preRight.length - preLeft.length)
  for (let index = 0; index < Math.max(preLeft.length, preRight.length); index++) {
    const x = preLeft[index]
    const y = preRight[index]
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    const order = compareIdentifier(x, y)
    if (order !== 0) return order
  }
  return 0
}
