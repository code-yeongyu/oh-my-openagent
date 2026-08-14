export function first<T>(xs: T[]): T | undefined { return xs[0] }
export function last<T>(xs: T[]): T | undefined { return xs[xs.length - 1] }
export function unique<T>(xs: T[]): T[] { return [...new Set(xs)] }
