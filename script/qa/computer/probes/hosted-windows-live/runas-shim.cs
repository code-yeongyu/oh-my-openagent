using System;
using System.IO;

// Stand-in for `runas.exe /trustlevel:<level> "<command>"`, placed ahead of the system runas on PATH by the SP-N
// prepare leg. On the hosted runner the real call leaves the child at High; this starts the same command line under the
// caller's own token with its mandatory label lowered to Medium, reads the label back from the started process and logs
// one line per call to OMO_HWL_RUNAS_LOG. Any other argument shape is refused, so nothing else is silently rerouted.
public static class RunasShim {
    const string Medium = "S-1-16-8192";

    public static int Main(string[] args) {
        string log = Environment.GetEnvironmentVariable("OMO_HWL_RUNAS_LOG");
        string command = null;
        bool trustLevel = false;
        foreach (string a in args) {
            if (a.StartsWith("/trustlevel:", StringComparison.OrdinalIgnoreCase)) { trustLevel = true; } else if (command == null) { command = a; } else { command = null; break; }
        }
        if (!trustLevel || command == null) {
            Write(log, "runas-shim REFUSED args=" + string.Join(" ", args));
            return 87;
        }
        int pid;
        try { pid = OmoHwl.Token.Start(command, Medium); } catch (Exception e) {
            Write(log, "runas-shim START-FAILED " + e.Message + " cmd=" + command);
            return 1;
        }
        string label;
        try { label = OmoHwl.Token.IntegritySid(pid); } catch (Exception e) { label = "unread (" + e.Message + ")"; }
        Write(log, "runas-shim pid=" + pid + " label=" + label + " cmd=" + command);
        return 0;
    }

    static void Write(string log, string line) {
        Console.WriteLine(line);
        if (!string.IsNullOrEmpty(log)) { File.AppendAllText(log, line + Environment.NewLine); }
    }
}
