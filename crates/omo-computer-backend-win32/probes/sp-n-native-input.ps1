# SP-N native input: SendInput, foreground acquisition, the hook-free barrier and timer measurements.
# A C# fragment of the partial class SpN; sp-n.ps1 compiles every sp-n-native-*.ps1 together.
$SpNNative += @'
public static partial class SpN {
  // ---------------------------------------------------------------- small helpers
  public static Hashtable H() { return new Hashtable(); }
  public static double Ms(long ticks) { return ticks * 1000.0 / Stopwatch.Frequency; }

  public static Hashtable Stats(List<double> xs) {
    var s = new List<double>(xs); s.Sort();
    var h = H(); h["n"] = s.Count;
    if (s.Count == 0) return h;
    h["min"] = Math.Round(s[0], 3); h["max"] = Math.Round(s[s.Count - 1], 3);
    h["p50"] = Math.Round(Pct(s, 0.50), 3); h["p95"] = Math.Round(Pct(s, 0.95), 3);
    return h;
  }
  static double Pct(List<double> sorted, double p) {
    int i = (int)Math.Ceiling(p * sorted.Count) - 1; if (i < 0) i = 0; if (i >= sorted.Count) i = sorted.Count - 1; return sorted[i];
  }

  public static string Text(IntPtr h) { var b = new StringBuilder(512); GetWindowTextW(h, b, 512); return b.ToString(); }
  public static string Cls(IntPtr h) { var b = new StringBuilder(256); GetClassNameW(h, b, 256); return b.ToString(); }

  public static IntPtr FindTop(string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate (IntPtr h, IntPtr lp) { if (IsWindowVisible(h) && Text(h) == title) { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
  public static IntPtr FindTopByClass(string cls) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate (IntPtr h, IntPtr lp) { if (IsWindowVisible(h) && Cls(h) == cls) { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
  public static IntPtr FindChild(IntPtr parent, string cls) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(parent, delegate (IntPtr h, IntPtr lp) { if (Cls(h) == cls) { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
  public static ArrayList ChildClasses(IntPtr parent) {
    var l = new ArrayList();
    EnumChildWindows(parent, delegate (IntPtr h, IntPtr lp) { l.Add(Cls(h)); return true; }, IntPtr.Zero);
    return l;
  }

  public static uint SessionOf(uint pid) { uint s; ProcessIdToSessionId(pid, out s); return s; }
  public static uint OwnSession() { return SessionOf(GetCurrentProcessId()); }

  // WTS_CONNECTSTATE_CLASS of a session: 0 Active, 1 Connected, 4 Disconnected, ...
  public static int ConnectState(uint sid) {
    IntPtr buf; uint n;
    if (!WTSQuerySessionInformationW(IntPtr.Zero, sid, 8, out buf, out n)) return -1;
    int v = Marshal.ReadInt32(buf); WTSFreeMemory(buf); return v;
  }

  public static string InputDesktop() {
    IntPtr d = OpenInputDesktop(0, false, 0x0001);
    if (d == IntPtr.Zero) return null;
    var b = new StringBuilder(256); int needed;
    GetUserObjectInformationW(d, 2, b, 512, out needed);
    CloseDesktop(d);
    return b.ToString();
  }

  public static IntPtr FocusOf(IntPtr top) {
    uint pid; uint tid = GetWindowThreadProcessId(top, out pid);
    var g = new GUITHREADINFO(); g.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
    if (!GetGUIThreadInfo(tid, ref g)) return IntPtr.Zero;
    return g.hwndFocus;
  }

  public static string GetTextOf(IntPtr h) {
    IntPtr len;
    if (SendMessageTimeoutW(h, WM_GETTEXTLENGTH, IntPtr.Zero, IntPtr.Zero, SMTO_ABORTIFHUNG, 1500, out len) == IntPtr.Zero) return null;
    var b = new StringBuilder(len.ToInt32() + 2); IntPtr r;
    if (SendMessageTimeoutW(h, WM_GETTEXT, (IntPtr)(len.ToInt32() + 1), b, SMTO_ABORTIFHUNG, 1500, out r) == IntPtr.Zero) return null;
    return b.ToString();
  }

  // ---------------------------------------------------------------- input
  static INPUT Key(ushort vk, ushort scan, uint flags) {
    var i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; return i;
  }
  static INPUT Mouse(int dx, int dy, uint data, uint flags) {
    var i = new INPUT(); i.type = 0; i.u.mi.dx = dx; i.u.mi.dy = dy; i.u.mi.mouseData = data; i.u.mi.dwFlags = flags; return i;
  }
  public static uint SendChars(string s, out int err) {
    var l = new List<INPUT>();
    foreach (char c in s) { l.Add(Key(0, c, KEYEVENTF_UNICODE)); l.Add(Key(0, c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)); }
    uint n = SendInput((uint)l.Count, l.ToArray(), INPUT_SIZE); err = Marshal.GetLastWin32Error(); return n;
  }
  public static uint SendVk(ushort vk, bool up, out int err) {
    var a = new INPUT[] { Key(vk, 0, up ? KEYEVENTF_KEYUP : 0) };
    uint n = SendInput(1, a, INPUT_SIZE); err = Marshal.GetLastWin32Error(); return n;
  }
  public static uint SendChord(ushort mod, ushort vk) {
    var a = new INPUT[] { Key(mod, 0, 0), Key(vk, 0, 0), Key(vk, 0, KEYEVENTF_KEYUP), Key(mod, 0, KEYEVENTF_KEYUP) };
    return SendInput(4, a, INPUT_SIZE);
  }
  public static void ZeroMotion() { var a = new INPUT[] { Mouse(0, 0, 0, MOUSEEVENTF_MOVE) }; SendInput(1, a, INPUT_SIZE); }
  public static uint Wheel(int notches) { var a = new INPUT[] { Mouse(0, 0, (uint)(notches * 120), MOUSEEVENTF_WHEEL) }; return SendInput(1, a, INPUT_SIZE); }

  // Foreground: plain SetForegroundWindow, retried after a zero-motion input
  // (the engine's rule); then, probe-only, an attached-input fallback. The
  // method used is reported so a row never hides how it got the foreground.
  public static string Foreground(IntPtr h) {
    if (GetForegroundWindow() == h) return "already";
    SetForegroundWindow(h);
    if (WaitFg(h)) return "plain";
    ZeroMotion(); SetForegroundWindow(h);
    if (WaitFg(h)) return "zero_motion";
    uint pid; uint fgTid = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    uint me = GetCurrentThreadId();
    AttachThreadInput(me, fgTid, true); BringWindowToTop(h); SetForegroundWindow(h); AttachThreadInput(me, fgTid, false);
    if (WaitFg(h)) return "attached_probe_only";
    return null;
  }
  static bool WaitFg(IntPtr h) {
    var sw = Stopwatch.StartNew();
    while (sw.ElapsedMilliseconds < 500) { if (GetForegroundWindow() == h) return true; Thread.Sleep(10); }
    return false;
  }

  // ---------------------------------------------------------------- barrier (old OMW-16 mechanics, no hook)
  public const int HANG_GUARD_MS = 5000;
  static bool WaitFor(Func<bool> done) {
    var sw = Stopwatch.StartNew();
    while (!done()) { if (sw.ElapsedMilliseconds >= HANG_GUARD_MS) return false; Thread.Yield(); }
    return true;
  }
  // Routed hop: the sentinel's async key state flips once the RIT routed every earlier event.
  public static bool Routed() {
    int e;
    if ((GetAsyncKeyState(SENTINEL_VK) & 0x8000) != 0) { SendVk(SENTINEL_VK, true, out e); WaitFor(delegate { return (GetAsyncKeyState(SENTINEL_VK) & 0x8000) == 0; }); }
    SendVk(SENTINEL_VK, false, out e);
    bool down = WaitFor(delegate { return (GetAsyncKeyState(SENTINEL_VK) & 0x8000) != 0; });
    SendVk(SENTINEL_VK, true, out e);
    bool up = WaitFor(delegate { return (GetAsyncKeyState(SENTINEL_VK) & 0x8000) == 0; });
    return down && up;
  }
  // Consumed hop: WM_PAINT is generated only when the thread's queues are empty.
  public static IntPtr PaintProbe(IntPtr posted, IntPtr top) {
    if (posted != IntPtr.Zero && IsWindowVisible(posted) && !IsIconic(posted)) return posted;
    IntPtr f = FocusOf(top);
    if (f != IntPtr.Zero && IsWindowVisible(f)) return f;
    return top;
  }
  public static bool Consumed(IntPtr w) {
    var r = new RECT(); r.Left = 0; r.Top = 0; r.Right = 1; r.Bottom = 1;
    if (!InvalidateRect(w, ref r, false)) return false;
    return WaitFor(delegate { return !GetUpdateRect(w, IntPtr.Zero, false); });
  }

  // ---------------------------------------------------------------- timers
  public static Hashtable DwmFlushTimes(int warm, int n) {
    var xs = new List<double>(); int hr = 0;
    for (int i = 0; i < warm + n; i++) {
      long t0 = Stopwatch.GetTimestamp(); hr = DwmFlush(); long t1 = Stopwatch.GetTimestamp();
      if (i >= warm) xs.Add(Ms(t1 - t0));
    }
    var h = Stats(xs); h["hresult"] = hr; return h;
  }
  public static Hashtable SleepTimes(int warm, int n, bool highRes) {
    var xs = new List<double>();
    IntPtr t = IntPtr.Zero;
    if (highRes) { t = CreateWaitableTimerExW(IntPtr.Zero, IntPtr.Zero, 0x2, 0x1F0003); if (t == IntPtr.Zero) { var e = H(); e["error"] = Marshal.GetLastWin32Error(); return e; } }
    for (int i = 0; i < warm + n; i++) {
      long t0 = Stopwatch.GetTimestamp();
      if (highRes) { long due = -10000; SetWaitableTimer(t, ref due, 0, IntPtr.Zero, IntPtr.Zero, false); WaitForSingleObject(t, 0xFFFFFFFF); } else Thread.Sleep(1);
      long t1 = Stopwatch.GetTimestamp();
      if (i >= warm) xs.Add(Ms(t1 - t0));
    }
    if (t != IntPtr.Zero) CloseHandle(t);
    return Stats(xs);
  }

}
'@
