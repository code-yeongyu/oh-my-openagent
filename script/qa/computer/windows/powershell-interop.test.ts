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
  for (const match of source.matchAll(/\[DllImport\(([^\]]*)\)\][^;(]*?\b(\w+)\s*\(([^)]*)\)/g)) {
    const [, attributes = "", name = "", parameters = ""] = match
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

  for (const file of readdirSync(DIR)
    .filter((name) => name.endsWith(".ps1"))
    .sort()) {
    test(`${file}: every wide Win32 import declares CharSet.Unicode`, () => {
      expect(wideImportsWithoutUnicode(readFileSync(join(DIR, file), "utf8"))).toEqual([])
    })
  }
})
