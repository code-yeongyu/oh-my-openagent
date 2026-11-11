# SP-N native declarations: Win32 structs, P/Invoke imports and message constants.
# A C# fragment of the partial class SpN; sp-n.ps1 compiles every sp-n-native-*.ps1 together.
$SpNNative += @'
public static partial class SpN {
  // ---------------------------------------------------------------- Win32
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct SIZE { public int Cx, Cy; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO { public int cbSize; public uint flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret; }
  [StructLayout(LayoutKind.Sequential)] public struct BITMAPINFOHEADER { public int biSize, biWidth, biHeight; public short biPlanes, biBitCount; public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant; }
  [StructLayout(LayoutKind.Sequential)] public struct BLENDFUNCTION { public byte BlendOp, BlendFlags, SourceConstantAlpha, AlphaFormat; }
  [StructLayout(LayoutKind.Sequential)] public struct SizeInt32 { public int Width, Height; }
  [StructLayout(LayoutKind.Sequential)] public struct TEX2DDESC { public uint Width, Height, MipLevels, ArraySize, Format, SampleCount, SampleQuality, Usage, BindFlags, CPUAccessFlags, MiscFlags; }
  [StructLayout(LayoutKind.Sequential)] public struct MAPPED { public IntPtr pData; public uint RowPitch, DepthPitch; }
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lp);

  [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern bool GetUserObjectInformationW(IntPtr h, int index, StringBuilder buf, int len, out int needed);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);
  [DllImport("kernel32.dll")] public static extern bool ProcessIdToSessionId(uint pid, out uint sid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentProcessId();
  [DllImport("kernel32.dll")] public static extern uint WTSGetActiveConsoleSessionId();
  [DllImport("wtsapi32.dll", SetLastError = true)] public static extern bool WTSQuerySessionInformationW(IntPtr server, uint sid, int cls, out IntPtr buf, out uint bytes);
  [DllImport("wtsapi32.dll")] public static extern void WTSFreeMemory(IntPtr p);
  [DllImport("wtsapi32.dll", SetLastError = true)] public static extern bool WTSDisconnectSession(IntPtr server, uint sid, bool wait);
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool GetGUIThreadInfo(uint tid, ref GUITHREADINFO gti);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool InvalidateRect(IntPtr h, ref RECT r, bool erase);
  [DllImport("user32.dll")] public static extern bool GetUpdateRect(IntPtr h, IntPtr r, bool erase);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SendMessageTimeoutW(IntPtr h, uint msg, IntPtr w, StringBuilder l, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SendMessageTimeoutW(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lp);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder b, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder b, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern IntPtr CreateWindowExW(uint ex, string cls, string title, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
  [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool UpdateLayeredWindow(IntPtr h, IntPtr dst, ref POINT pt, ref SIZE sz, IntPtr src, ref POINT srcPt, uint key, ref BLENDFUNCTION blend, uint flags);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowDisplayAffinity(IntPtr h, uint aff);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool GetWindowDisplayAffinity(IntPtr h, out uint aff);
  [DllImport("user32.dll")] public static extern bool PeekMessageW(out MSG m, IntPtr h, uint min, uint max, uint remove);
  [DllImport("user32.dll")] public static extern bool TranslateMessage(ref MSG m);
  [DllImport("user32.dll")] public static extern IntPtr DispatchMessageW(ref MSG m);
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt; }
  [DllImport("user32.dll")] public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool LockWorkStation();
  [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr dc);
  [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr dc, IntPtr o);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr o);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateDIBSection(IntPtr dc, ref BITMAPINFOHEADER bi, uint usage, out IntPtr bits, IntPtr sec, uint off);
  [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
  [DllImport("dwmapi.dll")] public static extern int DwmFlush();
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr CreateWaitableTimerExW(IntPtr attr, IntPtr name, uint flags, uint access);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetWaitableTimer(IntPtr t, ref long due, int period, IntPtr cb, IntPtr arg, bool resume);
  [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
  [DllImport("combase.dll")] public static extern int RoInitialize(int t);
  [DllImport("combase.dll", CharSet = CharSet.Unicode)] public static extern int WindowsCreateString(string s, int len, out IntPtr h);
  [DllImport("combase.dll")] public static extern int WindowsDeleteString(IntPtr h);
  [DllImport("combase.dll")] public static extern int RoGetActivationFactory(IntPtr cls, ref Guid iid, out IntPtr factory);
  [DllImport("d3d11.dll")] public static extern int D3D11CreateDevice(IntPtr adapter, int driverType, IntPtr soft, uint flags, IntPtr levels, uint nLevels, uint sdk, out IntPtr device, out int level, out IntPtr ctx);
  [DllImport("d3d11.dll")] public static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgi, out IntPtr inspectable);
  public delegate uint PowerCallback(IntPtr ctx, uint type, IntPtr setting);
  [StructLayout(LayoutKind.Sequential)] public struct SUBSCRIBE { public PowerCallback Callback; public IntPtr Context; }
  [DllImport("powrprof.dll")] public static extern uint PowerSettingRegisterNotification(ref Guid setting, uint flags, ref SUBSCRIBE recipient, out IntPtr handle);
  [DllImport("powrprof.dll")] public static extern uint PowerSettingUnregisterNotification(IntPtr handle);

  const uint WM_KEYDOWN = 0x100, WM_KEYUP = 0x101, WM_CHAR = 0x102, WM_GETTEXT = 0xD, WM_GETTEXTLENGTH = 0xE, WM_SYSCOMMAND = 0x112;
  const uint SMTO_ABORTIFHUNG = 0x2;
  const uint KEYEVENTF_KEYUP = 0x2, KEYEVENTF_UNICODE = 0x4;
  const uint MOUSEEVENTF_MOVE = 0x1, MOUSEEVENTF_WHEEL = 0x800;
  public const int SENTINEL_VK = 0xE8;
  static readonly int INPUT_SIZE = Marshal.SizeOf(typeof(INPUT));

}
'@
