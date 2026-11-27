// The Windows QA PowerShell scripts declare their Win32 calls in inline C#. A wide ("...W") Win32
// function (by method name or EntryPoint), or any import that marshals a string, needs
// CharSet = CharSet.Unicode: without it a
// StringBuilder is marshalled as ANSI and a UTF-16 answer reads back as its first character
// (the interactive-desktop smoke read the input desktop "Default" as "D" on a hosted runner).
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const DIR = import.meta.dir

function wideImportsWithoutUnicode(source: string): string[] {
  const missing: string[] = []
  // Every import: its method name, its EntryPoint and its parameter list decide whether it is wide
  // (a ...W method or entry point) or marshals a string (string / StringBuilder parameter).
  // The method is the name before the first '(' after 'extern' (a [return: ...] attribute comes
  // before it), and its parameter list is read with balanced parentheses (a parameter may carry
  // its own [MarshalAs(...)] attribute).
  for (const match of source.matchAll(/\[DllImport\(([^\]]*)\)\]/g)) {
    const attributes = match[1] ?? ""
    const rest = source.slice((match.index ?? 0) + match[0].length)
    const method = /\bextern\b[^(;]*?\b(\w+)\s*\(/.exec(rest)
    if (method === null) continue
    const name = method[1] ?? ""
    const open = method.index + method[0].length
    let depth = 1
    let end = open
    while (end < rest.length && depth > 0) {
      if (rest[end] === "(") depth += 1
      else if (rest[end] === ")") depth -= 1
      end += 1
    }
    const parameters = rest.slice(open, end - 1)
    const entryPoint = /EntryPoint\s*=\s*"(\w+)"/.exec(attributes)?.[1] ?? ""
    const wide = name.endsWith("W") || entryPoint.endsWith("W")
    const marshalsString = /\b(string|StringBuilder)\b/.test(parameters)
    if ((wide || marshalsString) && !/CharSet\s*=\s*CharSet\.Unicode/.test(attributes)) missing.push(name)
  }
  return missing
}

describe("Windows QA PowerShell interop", () => {
  test("the check finds a wide import without CharSet.Unicode and accepts one with it", () => {
    expect(
      wideImportsWithoutUnicode(
        '[DllImport("user32.dll")] public static extern bool GetUserObjectInformationW(IntPtr o);',
      ),
    ).toEqual(["GetUserObjectInformationW"])
    expect(
      wideImportsWithoutUnicode(
        '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetWindowTextW(IntPtr h);',
      ),
    ).toEqual([])
    expect(
      wideImportsWithoutUnicode('[DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint f);'),
    ).toEqual([])
  })

  // Review L1 (#13348): the wide entry point can hide behind another method name, and an A or
  // neutral import that marshals a string defaults to ANSI too.
  test("the check also finds an EntryPoint ...W alias and a string-bearing import without CharSet.Unicode", () => {
    expect(
      wideImportsWithoutUnicode(
        '[DllImport("user32.dll", EntryPoint = "GetUserObjectInformationW")] public static extern bool ReadName(IntPtr o);',
      ),
    ).toEqual(["ReadName"])
    expect(
      wideImportsWithoutUnicode(
        '[DllImport("user32.dll")] public static extern int MessageBox(IntPtr h, string text, string caption, uint t);',
      ),
    ).toEqual(["MessageBox"])
    expect(
      wideImportsWithoutUnicode(
        '[DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder name, int n);',
      ),
    ).toEqual(["GetClassName"])
    expect(
      wideImportsWithoutUnicode(
        '[DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetClassNameW")] public static extern int ClassName(IntPtr h, StringBuilder name, int n);',
      ),
    ).toEqual([])
  })

  // Review L1 (#13348 at 7f5cb94cf0): an attribute between the import and the method, and an
  // attribute inside the parameter list, must not hide the import or a later string parameter.
  test("the check reads past a [return: ...] attribute and past an attribute inside the parameter list", () => {
    expect(
      wideImportsWithoutUnicode(
        '[DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool GetUserObjectInformationW(IntPtr o, int i, StringBuilder s, int l, out int n);',
      ),
    ).toEqual(["GetUserObjectInformationW"])
    expect(
      wideImportsWithoutUnicode(
        '[DllImport("user32.dll")] public static extern int GetClassName([MarshalAs(UnmanagedType.SysInt)] IntPtr h, StringBuilder name, int n);',
      ),
    ).toEqual(["GetClassName"])
    expect(
      wideImportsWithoutUnicode(
        '[DllImport("user32.dll", CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool GetWindowTextW([MarshalAs(UnmanagedType.SysInt)] IntPtr h, StringBuilder s, int n);',
      ),
    ).toEqual([])
  })

  for (const file of readdirSync(DIR)
    .filter((name) => name.endsWith(".ps1"))
    .sort()) {
    test(`${file}: every wide Win32 import declares CharSet.Unicode`, () => {
      expect(wideImportsWithoutUnicode(readFileSync(join(DIR, file), "utf8"))).toEqual([])
    })
  }
})
