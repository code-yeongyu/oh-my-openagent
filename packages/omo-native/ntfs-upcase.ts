// The case fold NTFS path identity uses (#12780, #12809). NTFS upcases each UTF-16 unit through the $UpCase
// table written when the volume was formatted, so a volume knows only the case pairs of its Unicode version. JS
// toUpperCase() follows the current one and pairs later additions (U+10D0 with U+1C90, U+AB70 with U+13A0) that
// an older volume keeps distinct. This table is frozen: it holds the one-unit to one-unit uppercase pairs whose
// both code points were assigned by Unicode 3.2, the version of the oldest volumes omo can meet, so two paths it
// folds together are the same name on every volume. A pair added later is never folded; on a newer volume that
// only makes two spellings of one path compare different, never two paths compare equal.
//
// Each run is [first, last, step, delta]: the units first, first + step, ... last uppercase to unit + delta.
// Derived from the BMP units whose JS uppercase is a single other unit, keeping those whose unit and uppercase
// both have a category other than Cn in the Unicode 3.2 character database.
const RUNS: readonly number[] = [
  0x0061, 0x007a, 1, -32, 0x00b5, 0x00b5, 1, 743, 0x00e0, 0x00f6, 1, -32, 0x00f8, 0x00fe, 1, -32,
  0x00ff, 0x00ff, 1, 121, 0x0101, 0x012f, 2, -1, 0x0131, 0x0131, 1, -232, 0x0133, 0x0137, 2, -1,
  0x013a, 0x0148, 2, -1, 0x014b, 0x0177, 2, -1, 0x017a, 0x017e, 2, -1, 0x017f, 0x017f, 1, -300,
  0x0183, 0x0185, 2, -1, 0x0188, 0x0188, 1, -1, 0x018c, 0x018c, 1, -1, 0x0192, 0x0192, 1, -1, 0x0195, 0x0195, 1, 97,
  0x0199, 0x0199, 1, -1, 0x019e, 0x019e, 1, 130, 0x01a1, 0x01a5, 2, -1, 0x01a8, 0x01a8, 1, -1, 0x01ad, 0x01ad, 1, -1,
  0x01b0, 0x01b0, 1, -1, 0x01b4, 0x01b6, 2, -1, 0x01b9, 0x01b9, 1, -1, 0x01bd, 0x01bd, 1, -1, 0x01bf, 0x01bf, 1, 56,
  0x01c5, 0x01c5, 1, -1, 0x01c6, 0x01c6, 1, -2, 0x01c8, 0x01c8, 1, -1, 0x01c9, 0x01c9, 1, -2, 0x01cb, 0x01cb, 1, -1,
  0x01cc, 0x01cc, 1, -2, 0x01ce, 0x01dc, 2, -1, 0x01dd, 0x01dd, 1, -79, 0x01df, 0x01ef, 2, -1, 0x01f2, 0x01f2, 1, -1,
  0x01f3, 0x01f3, 1, -2, 0x01f5, 0x01f5, 1, -1, 0x01f9, 0x021f, 2, -1, 0x0223, 0x0233, 2, -1,
  0x0253, 0x0253, 1, -210, 0x0254, 0x0254, 1, -206, 0x0256, 0x0257, 1, -205, 0x0259, 0x0259, 1, -202,
  0x025b, 0x025b, 1, -203, 0x0260, 0x0260, 1, -205, 0x0263, 0x0263, 1, -207, 0x0268, 0x0268, 1, -209,
  0x0269, 0x0269, 1, -211, 0x026f, 0x026f, 1, -211, 0x0272, 0x0272, 1, -213, 0x0275, 0x0275, 1, -214,
  0x0280, 0x0280, 1, -218, 0x0283, 0x0283, 1, -218, 0x0288, 0x0288, 1, -218, 0x028a, 0x028b, 1, -217,
  0x0292, 0x0292, 1, -219, 0x0345, 0x0345, 1, 84, 0x03ac, 0x03ac, 1, -38, 0x03ad, 0x03af, 1, -37,
  0x03b1, 0x03c1, 1, -32, 0x03c2, 0x03c2, 1, -31, 0x03c3, 0x03cb, 1, -32, 0x03cc, 0x03cc, 1, -64,
  0x03cd, 0x03ce, 1, -63, 0x03d0, 0x03d0, 1, -62, 0x03d1, 0x03d1, 1, -57, 0x03d5, 0x03d5, 1, -47,
  0x03d6, 0x03d6, 1, -54, 0x03d9, 0x03ef, 2, -1, 0x03f0, 0x03f0, 1, -86, 0x03f1, 0x03f1, 1, -80,
  0x03f5, 0x03f5, 1, -96, 0x0430, 0x044f, 1, -32, 0x0450, 0x045f, 1, -80, 0x0461, 0x0481, 2, -1,
  0x048b, 0x04bf, 2, -1, 0x04c2, 0x04ce, 2, -1, 0x04d1, 0x04f5, 2, -1, 0x04f9, 0x04f9, 1, -1, 0x0501, 0x050f, 2, -1,
  0x0561, 0x0586, 1, -48, 0x1e01, 0x1e95, 2, -1, 0x1e9b, 0x1e9b, 1, -59, 0x1ea1, 0x1ef9, 2, -1, 0x1f00, 0x1f07, 1, 8,
  0x1f10, 0x1f15, 1, 8, 0x1f20, 0x1f27, 1, 8, 0x1f30, 0x1f37, 1, 8, 0x1f40, 0x1f45, 1, 8, 0x1f51, 0x1f57, 2, 8,
  0x1f60, 0x1f67, 1, 8, 0x1f70, 0x1f71, 1, 74, 0x1f72, 0x1f75, 1, 86, 0x1f76, 0x1f77, 1, 100, 0x1f78, 0x1f79, 1, 128,
  0x1f7a, 0x1f7b, 1, 112, 0x1f7c, 0x1f7d, 1, 126, 0x1fb0, 0x1fb1, 1, 8, 0x1fbe, 0x1fbe, 1, -7205,
  0x1fd0, 0x1fd1, 1, 8, 0x1fe0, 0x1fe1, 1, 8, 0x1fe5, 0x1fe5, 1, 7, 0x2170, 0x217f, 1, -16, 0x24d0, 0x24e9, 1, -26,
  0xff41, 0xff5a, 1, -32,
]

const UPCASE = (() => {
  const table = new Map<number, number>()
  for (let index = 0; index < RUNS.length; index += 4) {
    const [first, last, step, delta] = RUNS.slice(index, index + 4) as [number, number, number, number]
    for (let unit = first; unit <= last; unit += step) table.set(unit, unit + delta)
  }
  return table
})()

/** `path` with each UTF-16 unit replaced by its frozen NTFS uppercase, when it has one; the length never changes. */
export function foldNtfsCase(path: string): string {
  let folded = ""
  for (let index = 0; index < path.length; index += 1) {
    const unit = path.charCodeAt(index)
    folded += String.fromCharCode(UPCASE.get(unit) ?? unit)
  }
  return folded
}
