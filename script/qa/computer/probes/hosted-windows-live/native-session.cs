using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace OmoHwl {
    public sealed class Sample {
        public long ms { get; set; }
        public int connect { get; set; }
        public int @lock { get; set; }
        public string desktop { get; set; }
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct SidAndAttributes { public IntPtr Sid; public uint Attributes; }

    [StructLayout(LayoutKind.Sequential)]
    public struct ProcessInformation { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct StartupInfo {
        public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
        public int dwX; public int dwY; public int dwXSize; public int dwYSize;
        public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute;
        public int dwFlags; public short wShowWindow; public short cbReserved2;
        public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KeybdInput { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    // INPUT is a tagged union whose largest member (MOUSEINPUT) makes it 40 bytes on x64; SendInput rejects any other cbSize.
    [StructLayout(LayoutKind.Explicit, Size = 40)]
    public struct KeyInput { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KeybdInput ki; }

    public static class Session {
        [DllImport("kernel32.dll")] static extern bool ProcessIdToSessionId(uint pid, out uint sid);
        [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
        [DllImport("user32.dll", SetLastError = true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
        [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetUserObjectInformation(IntPtr h, int index, StringBuilder buf, int len, out int needed);
        [DllImport("wtsapi32.dll", SetLastError = true)] static extern bool WTSQuerySessionInformation(IntPtr server, uint sid, int cls, out IntPtr buf, out uint bytes);
        [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr p);
        [DllImport("wtsapi32.dll", SetLastError = true)] static extern bool WTSDisconnectSession(IntPtr server, uint sid, bool wait);
        [DllImport("user32.dll", SetLastError = true)] public static extern bool LockWorkStation();

        public static uint Own() { uint s; ProcessIdToSessionId(GetCurrentProcessId(), out s); return s; }

        public static string InputDesktop() {
            IntPtr h = OpenInputDesktop(0, false, 0);
            if (h == IntPtr.Zero) { return null; }
            try {
                StringBuilder sb = new StringBuilder(256);
                int needed;
                return GetUserObjectInformation(h, 2, sb, sb.Capacity * 2, out needed) ? sb.ToString() : null;
            } finally { CloseDesktop(h); }
        }

        // WTSConnectState (class 8); -100 when the read itself failed, which is never a state.
        public static int ConnectState(uint sid) {
            IntPtr b; uint n;
            if (!WTSQuerySessionInformation(IntPtr.Zero, sid, 8, out b, out n)) { return -100; }
            try { return Marshal.ReadInt32(b); } finally { WTSFreeMemory(b); }
        }

        // WTSSessionInfoEx (class 25) SessionFlags: 0 locked, 1 unlocked, -1 unknown. WTSINFOEXW is a DWORD Level followed by a
        // union aligned to 8 (it holds LARGE_INTEGERs), so SessionId sits at 8 and SessionFlags at 16; the SessionId read-back
        // proves the layout, and any mismatch returns a negative code below -100 instead of a flag.
        public static int LockFlag(uint sid) {
            IntPtr b; uint n;
            if (!WTSQuerySessionInformation(IntPtr.Zero, sid, 25, out b, out n)) { return -100; }
            try {
                if (Marshal.ReadInt32(b, 0) != 1) { return -101; }
                if ((uint)Marshal.ReadInt32(b, 8) != sid) { return -102; }
                return Marshal.ReadInt32(b, 16);
            } finally { WTSFreeMemory(b); }
        }

        public static Sample Read(uint sid, long ms) {
            return new Sample { ms = ms, connect = ConnectState(sid), @lock = LockFlag(sid), desktop = InputDesktop() };
        }

        public static int DisconnectOwn() {
            return WTSDisconnectSession(IntPtr.Zero, Own(), false) ? 0 : Marshal.GetLastWin32Error();
        }

        public static List<Sample> Poll(uint sid, int totalMs, int stepMs) {
            List<Sample> all = new List<Sample>();
            System.Diagnostics.Stopwatch sw = System.Diagnostics.Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds <= totalMs) {
                all.Add(Read(sid, sw.ElapsedMilliseconds));
                System.Threading.Thread.Sleep(stepMs);
            }
            return all;
        }
    }

    public static class Token {
        [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
        [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr h);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr proc, uint access, out IntPtr tok);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr tok, int cls, IntPtr buf, int len, out int ret);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool SetTokenInformation(IntPtr tok, int cls, IntPtr buf, int len);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool DuplicateTokenEx(IntPtr tok, uint access, IntPtr attrs, int level, int type, out IntPtr dup);
        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertStringSidToSid(string s, out IntPtr sid);
        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr s);
        [DllImport("advapi32.dll")] static extern int GetLengthSid(IntPtr sid);
        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool CreateProcessAsUser(IntPtr tok, string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref StartupInfo si, out ProcessInformation pi);

        public static string IntegritySid(int pid) {
            IntPtr proc = OpenProcess(0x1000, false, pid);
            if (proc == IntPtr.Zero) { throw new InvalidOperationException("OpenProcess " + pid + " error " + Marshal.GetLastWin32Error()); }
            IntPtr tok = IntPtr.Zero;
            try {
                if (!OpenProcessToken(proc, 0x0008, out tok)) { throw new InvalidOperationException("OpenProcessToken error " + Marshal.GetLastWin32Error()); }
                int len;
                GetTokenInformation(tok, 25, IntPtr.Zero, 0, out len);
                IntPtr buf = Marshal.AllocHGlobal(len);
                try {
                    if (!GetTokenInformation(tok, 25, buf, len, out len)) { throw new InvalidOperationException("GetTokenInformation error " + Marshal.GetLastWin32Error()); }
                    IntPtr s;
                    if (!ConvertSidToStringSid(Marshal.ReadIntPtr(buf), out s)) { throw new InvalidOperationException("ConvertSidToStringSid error " + Marshal.GetLastWin32Error()); }
                    try { return Marshal.PtrToStringUni(s); } finally { LocalFree(s); }
                } finally { Marshal.FreeHGlobal(buf); }
            } finally {
                if (tok != IntPtr.Zero) { CloseHandle(tok); }
                CloseHandle(proc);
            }
        }

        // Starts commandLine on a duplicate of this process's own primary token. With label set, the duplicate's mandatory
        // label is lowered to it first (S-1-16-8192 makes a real Medium process); without it the child keeps this process's
        // level, so both arms of a measurement start through the same call and differ only in the label.
        public static int Start(string commandLine, string label) {
            IntPtr self = IntPtr.Zero, dup = IntPtr.Zero, sid = IntPtr.Zero, tml = IntPtr.Zero;
            try {
                if (!OpenProcessToken(GetCurrentProcess(), 0x0002 | 0x0008 | 0x0001 | 0x0080, out self)) { throw new InvalidOperationException("OpenProcessToken error " + Marshal.GetLastWin32Error()); }
                if (!DuplicateTokenEx(self, 0x02000000, IntPtr.Zero, 2, 1, out dup)) { throw new InvalidOperationException("DuplicateTokenEx error " + Marshal.GetLastWin32Error()); }
                if (label != null) {
                    if (!ConvertStringSidToSid(label, out sid)) { throw new InvalidOperationException("ConvertStringSidToSid error " + Marshal.GetLastWin32Error()); }
                    SidAndAttributes sa = new SidAndAttributes { Sid = sid, Attributes = 0x20 };
                    int size = Marshal.SizeOf(typeof(SidAndAttributes));
                    tml = Marshal.AllocHGlobal(size);
                    Marshal.StructureToPtr(sa, tml, false);
                    if (!SetTokenInformation(dup, 25, tml, size + GetLengthSid(sid))) { throw new InvalidOperationException("SetTokenInformation(TokenIntegrityLevel) error " + Marshal.GetLastWin32Error()); }
                }
                StartupInfo si = new StartupInfo();
                si.cb = Marshal.SizeOf(typeof(StartupInfo));
                si.lpDesktop = "winsta0\\default";
                ProcessInformation pi;
                if (!CreateProcessAsUser(dup, null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, false, 0x08000000, IntPtr.Zero, null, ref si, out pi)) {
                    throw new InvalidOperationException("CreateProcessAsUser error " + Marshal.GetLastWin32Error());
                }
                CloseHandle(pi.hThread);
                CloseHandle(pi.hProcess);
                return pi.dwProcessId;
            } finally {
                if (tml != IntPtr.Zero) { Marshal.FreeHGlobal(tml); }
                if (sid != IntPtr.Zero) { LocalFree(sid); }
                if (dup != IntPtr.Zero) { CloseHandle(dup); }
                if (self != IntPtr.Zero) { CloseHandle(self); }
            }
        }
    }

    public static class Input {
        [DllImport("user32.dll", SetLastError = true)] static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageW(IntPtr h, uint msg, IntPtr w, StringBuilder l);
        [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, KeyInput[] inputs, int size);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();

        public static int PostChar(IntPtr edit, char c) {
            return PostMessageW(edit, 0x0102, (IntPtr)c, (IntPtr)1) ? 0 : Marshal.GetLastWin32Error();
        }

        public static uint SendChar(char c) {
            KeyInput down = new KeyInput { type = 1, ki = new KeybdInput { wScan = c, dwFlags = 0x0004 } };
            KeyInput up = new KeyInput { type = 1, ki = new KeybdInput { wScan = c, dwFlags = 0x0004 | 0x0002 } };
            return SendInput(2, new KeyInput[] { down, up }, Marshal.SizeOf(typeof(KeyInput)));
        }

        public static string Text(IntPtr h) {
            StringBuilder sb = new StringBuilder(4096);
            SendMessageW(h, 0x000D, (IntPtr)sb.Capacity, sb);
            return sb.ToString();
        }
    }
}
