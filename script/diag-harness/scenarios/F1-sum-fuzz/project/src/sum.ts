import { V as a01 } from "./a01"
import { V as a02 } from "./a02"
import { V as a03 } from "./a03"
import { V as a04 } from "./a04"
import { V as a05 } from "./a05"
import { V as a06 } from "./a06"
import { V as a07 } from "./a07"
import { V as a08 } from "./a08"
import { V as a09 } from "./a09"
import { V as a10 } from "./a10"
import { V as a11 } from "./a11"
import { V as a12 } from "./a12"

const values = [a01, a02, a03, a04, a05, a06, a07, a08, a09, a10, a11, a12]

export const total: number = values.reduce((acc, v) => acc + v, 0)

const frequencies = new Map<number, number>()
for (const v of values) {
  frequencies.set(v, (frequencies.get(v) ?? 0) + 1)
}

export const modalCount: number = Math.max(...frequencies.values())
