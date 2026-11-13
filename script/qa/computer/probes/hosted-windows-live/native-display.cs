using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace OmoHwl {
    public sealed class Monitor {
        public bool primary { get; set; }
        public string device { get; set; }
        public int dpi { get; set; }
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct Luid { public uint Low; public int High; }

    [StructLayout(LayoutKind.Sequential)]
    public struct DcHeader { public int type; public uint size; public Luid adapterId; public uint id; }

    [StructLayout(LayoutKind.Sequential)]
    public struct DpiGet { public DcHeader header; public int minRel; public int curRel; public int maxRel; }

    [StructLayout(LayoutKind.Sequential)]
    public struct DpiSet { public DcHeader header; public int rel; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct SourceName { public DcHeader header; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string gdiName; }

    [StructLayout(LayoutKind.Sequential)]
    public struct PathSource { public Luid adapterId; public uint id; public uint modeIdx; public uint status; }

    [StructLayout(LayoutKind.Explicit, Size = 72)]
    public struct PathInfo { [FieldOffset(0)] public PathSource source; }

    [StructLayout(LayoutKind.Explicit, Size = 64)]
    public struct ModeInfo { [FieldOffset(0)] public uint infoType; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct MonitorInfoEx {
        public int cbSize; public int l, t, r, b; public int wl, wt, wr, wb; public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DevMode {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public short dmSpecVersion; public short dmDriverVersion; public short dmSize; public short dmDriverExtra; public int dmFields;
        public int dmPositionX; public int dmPositionY; public int dmDisplayOrientation; public int dmDisplayFixedOutput;
        public short dmColor; public short dmDuplex; public short dmYResolution; public short dmTTOption; public short dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public short dmLogPixels; public int dmBitsPerPel; public int dmPelsWidth; public int dmPelsHeight; public int dmDisplayFlags; public int dmDisplayFrequency;
        public int dmICMMethod; public int dmICMIntent; public int dmMediaType; public int dmDitherType; public int dmReserved1; public int dmReserved2; public int dmPanningWidth; public int dmPanningHeight;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DevInfoData { public uint cbSize; public Guid ClassGuid; public uint DevInst; public IntPtr Reserved; }

    public static class Display {
        delegate bool MonitorProc(IntPtr h, IntPtr dc, IntPtr rect, IntPtr data);
        [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorProc cb, IntPtr data);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr h, ref MonitorInfoEx mi);
        [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr h, int type, out uint x, out uint y);
        [DllImport("user32.dll", SetLastError = true)] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
        [DllImport("user32.dll")] static extern IntPtr GetThreadDpiAwarenessContext();
        [DllImport("user32.dll")] static extern int GetAwarenessFromDpiAwarenessContext(IntPtr ctx);
        [DllImport("user32.dll")] static extern int GetDisplayConfigBufferSizes(uint flags, out uint paths, out uint modes);
        [DllImport("user32.dll")] static extern int QueryDisplayConfig(uint flags, ref uint np, [Out] PathInfo[] paths, ref uint nm, [Out] ModeInfo[] modes, IntPtr topo);
        [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref DpiGet p);
        [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref SourceName p);
        [DllImport("user32.dll")] static extern int DisplayConfigSetDeviceInfo(ref DpiSet p);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplaySettings(string device, int mode, ref DevMode dm);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string device, ref DevMode dm, IntPtr hwnd, uint flags, IntPtr lParam);

        // Windows offers a scale step only when the mode is large enough for it (800x600 allows 100 % alone), so the
        // secondary is switched to its largest listed mode first. Returns "WxH rc=<ChangeDisplaySettingsEx result>".
        public static string SetLargestMode(string device) {
            DevMode best = new DevMode(); best.dmSize = (short)Marshal.SizeOf(typeof(DevMode));
            DevMode dm = new DevMode(); dm.dmSize = best.dmSize;
            long area = 0;
            for (int i = 0; EnumDisplaySettings(device, i, ref dm); i++) {
                long a = (long)dm.dmPelsWidth * dm.dmPelsHeight;
                if (a > area) { area = a; best = dm; }
            }
            if (area == 0) { return "no modes listed for " + device; }
            best.dmFields = 0x80000 | 0x100000;
            int rc = ChangeDisplaySettingsEx(device, ref best, IntPtr.Zero, 1, IntPtr.Zero);
            return best.dmPelsWidth + "x" + best.dmPelsHeight + " rc=" + rc;
        }

        // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 is the pseudo-handle -4; the read-back is the awareness actually in force.
        public static int MakePerMonitorAware() {
            SetProcessDpiAwarenessContext((IntPtr)(-4));
            return GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext());
        }

        public static List<Monitor> Monitors() {
            List<Monitor> all = new List<Monitor>();
            EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr h, IntPtr dc, IntPtr rect, IntPtr data) {
                MonitorInfoEx mi = new MonitorInfoEx();
                mi.cbSize = Marshal.SizeOf(typeof(MonitorInfoEx));
                GetMonitorInfo(h, ref mi);
                uint x, y;
                int hr = GetDpiForMonitor(h, 0, out x, out y);
                all.Add(new Monitor { primary = (mi.dwFlags & 1) != 0, device = mi.szDevice, dpi = hr == 0 ? (int)x : -hr });
                return true;
            }, IntPtr.Zero);
            return all;
        }

        // Display scale steps (percent) that DISPLAYCONFIG_DEVICE_INFO_GET/SET_DPI_SCALE (-3/-4) index relative to the
        // recommended step: minRel is the 100 % step's offset, so the recommended index is -minRel.
        static readonly int[] Steps = { 100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500 };

        // Sets the source whose GDI name is gdiName to percent. Returns "" on success, otherwise what failed.
        public static string SetScale(string gdiName, int percent) {
            uint np, nm;
            int rc = GetDisplayConfigBufferSizes(2, out np, out nm);
            if (rc != 0) { return "GetDisplayConfigBufferSizes " + rc; }
            PathInfo[] paths = new PathInfo[np];
            ModeInfo[] modes = new ModeInfo[nm];
            rc = QueryDisplayConfig(2, ref np, paths, ref nm, modes, IntPtr.Zero);
            if (rc != 0) { return "QueryDisplayConfig " + rc; }
            for (int i = 0; i < np; i++) {
                SourceName sn = new SourceName();
                sn.header = new DcHeader { type = 1, size = (uint)Marshal.SizeOf(typeof(SourceName)), adapterId = paths[i].source.adapterId, id = paths[i].source.id };
                if (DisplayConfigGetDeviceInfo(ref sn) != 0 || sn.gdiName != gdiName) { continue; }
                DpiGet g = new DpiGet();
                g.header = new DcHeader { type = -3, size = (uint)Marshal.SizeOf(typeof(DpiGet)), adapterId = sn.header.adapterId, id = sn.header.id };
                rc = DisplayConfigGetDeviceInfo(ref g);
                if (rc != 0) { return "GET_DPI_SCALE " + rc; }
                int target = Array.IndexOf(Steps, percent);
                int rel = target - (-g.minRel);
                if (rel < g.minRel || rel > g.maxRel) { return "step " + percent + " outside [" + g.minRel + "," + g.maxRel + "] rel " + rel; }
                DpiSet s = new DpiSet { rel = rel };
                s.header = new DcHeader { type = -4, size = (uint)Marshal.SizeOf(typeof(DpiSet)), adapterId = sn.header.adapterId, id = sn.header.id };
                rc = DisplayConfigSetDeviceInfo(ref s);
                return rc == 0 ? "" : "SET_DPI_SCALE " + rc;
            }
            return "no active path for " + gdiName;
        }
    }

    public static class Devices {
        [DllImport("setupapi.dll", SetLastError = true)] static extern IntPtr SetupDiCreateDeviceInfoList(ref Guid cls, IntPtr hwnd);
        [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool SetupDiCreateDeviceInfoW(IntPtr set, string name, ref Guid cls, string desc, IntPtr hwnd, uint flags, ref DevInfoData d);
        [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiSetDeviceRegistryPropertyW(IntPtr set, ref DevInfoData d, uint prop, byte[] buf, uint size);
        [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiCallClassInstaller(uint dif, IntPtr set, ref DevInfoData d);
        [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool SetupDiGetDeviceInstanceIdW(IntPtr set, ref DevInfoData d, StringBuilder id, int size, out int req);
        [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
        [DllImport("newdev.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool UpdateDriverForPlugAndPlayDevicesW(IntPtr hwnd, string hwid, string inf, uint flags, out bool reboot);

        // A root-enumerated device node with the given hardware id (what devcon/nefconw "install" does): create the
        // element, set SPDRP_HARDWAREID (1) as a REG_MULTI_SZ, then DIF_REGISTERDEVICE (0x19). Returns its instance id.
        public static string CreateRoot(string className, Guid cls, string hwid) {
            IntPtr set = SetupDiCreateDeviceInfoList(ref cls, IntPtr.Zero);
            if (set == new IntPtr(-1)) { throw new InvalidOperationException("SetupDiCreateDeviceInfoList error " + Marshal.GetLastWin32Error()); }
            try {
                DevInfoData d = new DevInfoData();
                d.cbSize = (uint)Marshal.SizeOf(typeof(DevInfoData));
                if (!SetupDiCreateDeviceInfoW(set, className, ref cls, null, IntPtr.Zero, 1, ref d)) { throw new InvalidOperationException("SetupDiCreateDeviceInfo error " + Marshal.GetLastWin32Error()); }
                byte[] ids = Encoding.Unicode.GetBytes(hwid + "\0\0");
                if (!SetupDiSetDeviceRegistryPropertyW(set, ref d, 1, ids, (uint)ids.Length)) { throw new InvalidOperationException("SetupDiSetDeviceRegistryProperty error " + Marshal.GetLastWin32Error()); }
                if (!SetupDiCallClassInstaller(0x19, set, ref d)) { throw new InvalidOperationException("DIF_REGISTERDEVICE error " + Marshal.GetLastWin32Error()); }
                StringBuilder sb = new StringBuilder(512);
                int req;
                SetupDiGetDeviceInstanceIdW(set, ref d, sb, sb.Capacity, out req);
                return sb.ToString();
            } finally { SetupDiDestroyDeviceInfoList(set); }
        }

        public static string UpdateDriver(string hwid, string infPath) {
            bool reboot;
            return UpdateDriverForPlugAndPlayDevicesW(IntPtr.Zero, hwid, infPath, 1, out reboot) ? (reboot ? "reboot" : "") : "UpdateDriverForPlugAndPlayDevices error " + Marshal.GetLastWin32Error();
        }
    }
}
