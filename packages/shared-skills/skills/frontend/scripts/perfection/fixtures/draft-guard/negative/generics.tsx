export const labels: Array<string> = ["Unlock the power", "🚀 launch"]
export const pick = <T,>(xs: T[]): T | undefined => xs[0]
export const first = <T extends object>(xs: T[]) => xs[0]
export const flag = (a: number, b: number) => (a<b && b>a ? "seamless sync" : "x")
export function Saved() {
  return <p>Saved 3 files</p>
}
