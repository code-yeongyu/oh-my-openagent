# SP-N native medium-integrity start: the UIPI and elevated rows need a helper at Medium beside the elevated fixture.
# A C# fragment of the partial class SpN; sp-n.ps1 compiles every sp-n-native-*.ps1 together.
# `runas /trustlevel:0x20000` leaves the child at High when UAC is off (the hosted runner), so the helper is started
# from a restricted copy of this process's own token (CreateRestrictedToken, LUA_TOKEN) whose mandatory label is
# lowered to Medium (SetTokenInformation, TokenIntegrityLevel), the documented way to run a lower-integrity child.
# Nothing here raises a label, adjusts a privilege or takes another account's token; the started process's label is
# read back, so a row never assumes the level it got.
$SpNNative += @'
public static partial class SpN {
  [StructLayout(LayoutKind.Sequential)] struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct TOKEN_MANDATORY_LABEL { public SID_AND_ATTRIBUTES Label; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFOW {
    public int cb; public string lpReserved, lpDesktop, lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public bool bInheritHandle; }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateFileW(string name, uint access, uint share, ref SECURITY_ATTRIBUTES sa, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("ntdll.dll")] static extern uint RtlNtStatusToDosError(uint status);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool CreateRestrictedToken(IntPtr existing, uint flags, uint nDisable, IntPtr disable, uint nDelete, IntPtr delete, uint nRestrict, IntPtr restrict, out IntPtr created);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertStringSidToSidW(string sid, out IntPtr psid);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertSidToStringSidW(IntPtr psid, out IntPtr text);
  [DllImport("advapi32.dll")] static extern int GetLengthSid(IntPtr sid);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr h);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool SetTokenInformation(IntPtr token, int cls, ref TOKEN_MANDATORY_LABEL info, int len);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr info, int len, out int needed);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessAsUserW(IntPtr token, string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref STARTUPINFOW si, out PROCESS_INFORMATION pi);

  public const string MEDIUM_LABEL = "S-1-16-8192";
  const int TokenIntegrityLevel = 25;
  const uint LUA_TOKEN = 0x4, SE_GROUP_INTEGRITY = 0x20;
  const uint TOKEN_ASSIGN_PRIMARY = 0x1, TOKEN_DUPLICATE = 0x2, TOKEN_QUERY = 0x8, TOKEN_ADJUST_DEFAULT = 0x80;
  const uint CREATE_NEW_CONSOLE = 0x10, STARTF_USESHOWWINDOW = 0x1, STARTF_USESTDHANDLES = 0x100;

  static Exception Failed(string what) {
    int code = Marshal.GetLastWin32Error();
    return new Exception(what + " failed: " + new System.ComponentModel.Win32Exception(code).Message + " (" + code + ")");
  }

  // Starts command from a restricted copy of this process's token labelled Medium, hidden, on this session's
  // interactive desktop, its stdout and stderr in the file log: @{ pid; label } with the label read back from the
  // started process, plus exitedWithin3s when it ended that early (a helper that dies before its first write).
  public static Hashtable StartMedium(string command, string log) {
    IntPtr own = IntPtr.Zero, lowered = IntPtr.Zero, sid = IntPtr.Zero, output = IntPtr.Zero;
    var pi = new PROCESS_INFORMATION();
    try {
      if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ASSIGN_PRIMARY | TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ADJUST_DEFAULT, out own))
        throw Failed("OpenProcessToken");
      if (!CreateRestrictedToken(own, LUA_TOKEN, 0, IntPtr.Zero, 0, IntPtr.Zero, 0, IntPtr.Zero, out lowered)) throw Failed("CreateRestrictedToken");
      if (!ConvertStringSidToSidW(MEDIUM_LABEL, out sid)) throw Failed("ConvertStringSidToSidW");
      var tml = new TOKEN_MANDATORY_LABEL(); tml.Label.Sid = sid; tml.Label.Attributes = SE_GROUP_INTEGRITY;
      if (!SetTokenInformation(lowered, TokenIntegrityLevel, ref tml, Marshal.SizeOf(typeof(TOKEN_MANDATORY_LABEL)) + GetLengthSid(sid)))
        throw Failed("SetTokenInformation(TokenIntegrityLevel)");
      var sa = new SECURITY_ATTRIBUTES(); sa.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)); sa.bInheritHandle = true;
      // GENERIC_WRITE, shared read/write, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL
      output = CreateFileW(log, 0x40000000, 0x3, ref sa, 2, 0x80, IntPtr.Zero);
      if (output == new IntPtr(-1)) { output = IntPtr.Zero; throw Failed("CreateFileW(" + log + ")"); }
      var si = new STARTUPINFOW(); si.cb = Marshal.SizeOf(typeof(STARTUPINFOW)); si.lpDesktop = "winsta0\\default";
      si.dwFlags = (int)(STARTF_USESHOWWINDOW | STARTF_USESTDHANDLES); si.wShowWindow = 0; si.hStdOutput = output; si.hStdError = output;
      if (!CreateProcessAsUserW(lowered, null, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, true, CREATE_NEW_CONSOLE, IntPtr.Zero, null, ref si, out pi))
        throw Failed("CreateProcessAsUserW");
      var h = H(); h["pid"] = pi.dwProcessId; h["label"] = LabelOf(pi.hProcess);
      uint code;
      if (WaitForSingleObject(pi.hProcess, 3000) == 0 && GetExitCodeProcess(pi.hProcess, out code)) {
        h["exitedWithin3s"] = (long)code;
        h["exitText"] = ExitText(code);
      }
      return h;
    } finally {
      foreach (var x in new[] { own, lowered, output, pi.hProcess, pi.hThread }) if (x != IntPtr.Zero) CloseHandle(x);
      if (sid != IntPtr.Zero) LocalFree(sid);
    }
  }

  // The system's text for an exit status: an error status (0xC...) through its Win32 error, else the code itself.
  static string ExitText(uint code) {
    const uint ERROR_MR_MID_NOT_FOUND = 317;
    uint win32 = code >= 0xC0000000 ? RtlNtStatusToDosError(code) : code;
    return win32 == ERROR_MR_MID_NOT_FOUND ? "no system text" : new System.ComponentModel.Win32Exception((int)win32).Message;
  }

  // The mandatory label SID of a process, as text.
  static string LabelOf(IntPtr process) {
    IntPtr token;
    if (!OpenProcessToken(process, TOKEN_QUERY, out token)) throw Failed("OpenProcessToken(started process)");
    IntPtr buf = IntPtr.Zero;
    try {
      int needed;
      GetTokenInformation(token, TokenIntegrityLevel, IntPtr.Zero, 0, out needed);
      buf = Marshal.AllocHGlobal(needed);
      if (!GetTokenInformation(token, TokenIntegrityLevel, buf, needed, out needed)) throw Failed("GetTokenInformation(TokenIntegrityLevel)");
      IntPtr text;
      if (!ConvertSidToStringSidW(Marshal.ReadIntPtr(buf), out text)) throw Failed("ConvertSidToStringSidW");
      try { return Marshal.PtrToStringUni(text); } finally { LocalFree(text); }
    } finally {
      if (buf != IntPtr.Zero) Marshal.FreeHGlobal(buf);
      CloseHandle(token);
    }
  }
}
'@
