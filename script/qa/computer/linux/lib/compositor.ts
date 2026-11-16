// Who owns screen 0's compositing-manager selection, read through libX11 with Python's ctypes
// (both are in the QA image; no X client tool prints a selection owner). The session waits
// on this after starting xcompmgr, so the capture path a scenario runs is fixed.
const PROBE = [
  "import ctypes, sys",
  "x = ctypes.cdll.LoadLibrary('libX11.so.6')",
  "x.XOpenDisplay.restype = ctypes.c_void_p",
  "x.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]",
  "x.XInternAtom.restype = ctypes.c_ulong",
  "x.XGetSelectionOwner.argtypes = [ctypes.c_void_p, ctypes.c_ulong]",
  "x.XGetSelectionOwner.restype = ctypes.c_ulong",
  "d = x.XOpenDisplay(None)",
  "d or sys.exit(2)",
  "print('owner 0x%x' % x.XGetSelectionOwner(d, x.XInternAtom(d, b'_NET_WM_CM_S0', 0)))",
].join("\n")

export function compositorOwnerArgv(python: string): string[] {
  return [python, "-c", PROBE]
}

export function ownsCompositorSelection(stdout: string): boolean {
  const owner = /^owner 0x([0-9a-f]+)$/m.exec(stdout)?.[1]
  return owner !== undefined && Number.parseInt(owner, 16) !== 0
}
