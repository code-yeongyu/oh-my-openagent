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
        foreach (string dir in Directories(command)) { Write(log, "runas-shim label " + dir + " -> " + Label(dir)); }
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

    // Every existing directory a quoted path on the command line points at. A Medium child cannot write a directory
    // whose mandatory label it does not reach, so the caller's own output directories are labelled Low first; nothing
    // outside the command line is touched.
    static System.Collections.Generic.List<string> Directories(string command) {
        var dirs = new System.Collections.Generic.List<string>();
        foreach (string part in command.Split('"')) {
            string candidate = part.Trim();
            if (candidate.Length < 4 || candidate.IndexOf(Path.DirectorySeparatorChar) < 0) { continue; }
            string dir;
            try { dir = Directory.Exists(candidate) ? Path.GetFullPath(candidate) : Path.GetDirectoryName(Path.GetFullPath(candidate)); } catch { continue; }
            if (dir != null && Directory.Exists(dir) && !dirs.Contains(dir)) { dirs.Add(dir); }
        }
        return dirs;
    }

    static string Label(string dir) {
        var psi = new System.Diagnostics.ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "icacls.exe"));
        psi.Arguments = "\"" + dir + "\" /setintegritylevel (OI)(CI)low";
        psi.UseShellExecute = false;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        using (var p = System.Diagnostics.Process.Start(psi)) {
            p.StandardOutput.ReadToEnd();
            p.StandardError.ReadToEnd();
            p.WaitForExit(15000);
            return "icacls exit " + p.ExitCode;
        }
    }

    static void Write(string log, string line) {
        Console.WriteLine(line);
        if (!string.IsNullOrEmpty(log)) { File.AppendAllText(log, line + Environment.NewLine); }
    }
}
