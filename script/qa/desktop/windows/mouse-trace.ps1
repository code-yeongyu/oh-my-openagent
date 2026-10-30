# Records every mouse event the raw input thread routes while a foreground pointer scenario of
# script/qa/desktop/windows.ts runs: a WH_MOUSE_LL hook in this separate process appends one line per
# event to $Log - `<message> <x> <y> <wheel delta> <injected 0|1> <top-level window at the point>` -
# so a failing scenario shows where the engine's move, button and wheel actually went. Passes every
# event on unchanged. Prints `ready` once the hook is installed; runs until the driver kills it.
param([Parameter(Mandatory = $true)][string]$Log)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
public static class QaMouseTrace {
	[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
	[StructLayout(LayoutKind.Sequential)] struct HookInfo { public POINT Point; public uint MouseData; public uint Flags; public uint Time; public IntPtr Extra; }
	[StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr Hwnd; public uint Message; public IntPtr WParam; public IntPtr LParam; public uint Time; public POINT Point; }
	delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
	[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
	[DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookExW(int id, HookProc proc, IntPtr module, uint thread);
	[DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
	[DllImport("user32.dll")] static extern int GetMessageW(out MSG message, IntPtr hwnd, uint min, uint max);
	[DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
	[DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
	[DllImport("kernel32.dll")] static extern IntPtr GetModuleHandleW(IntPtr name);
	static HookProc keep;
	static string path;
	static IntPtr Proc(int code, IntPtr wParam, IntPtr lParam) {
		if (code >= 0) {
			HookInfo info = (HookInfo)Marshal.PtrToStructure(lParam, typeof(HookInfo));
			IntPtr under = WindowFromPoint(info.Point);
			IntPtr root = under == IntPtr.Zero ? IntPtr.Zero : GetAncestor(under, 2);
			string line = String.Format("{0:X} {1} {2} {3} {4} {5}\n", wParam.ToInt64(), info.Point.X, info.Point.Y,
				(short)(info.MouseData >> 16), info.Flags & 1, root.ToInt64());
			File.AppendAllText(path, line);
		}
		return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
	}
	public static void Run(string log) {
		path = log;
		keep = Proc;
		IntPtr hook = SetWindowsHookExW(14, keep, GetModuleHandleW(IntPtr.Zero), 0); // WH_MOUSE_LL
		if (hook == IntPtr.Zero) throw new InvalidOperationException("SetWindowsHookExW(WH_MOUSE_LL) failed: " + Marshal.GetLastWin32Error());
		Console.Out.WriteLine("ready");
		Console.Out.Flush();
		MSG message;
		while (GetMessageW(out message, IntPtr.Zero, 0, 0) > 0) { }
	}
}
'@
# Physical pixels, like the engine, the probe and the pointer hosts.
[void][QaMouseTrace]::SetProcessDpiAwarenessContext([IntPtr]-4)
[QaMouseTrace]::Run($Log)
