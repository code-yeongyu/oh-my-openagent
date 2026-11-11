# SP-N native capture: pixel classes, PrintWindow, GDI BitBlt, the layered overlay, WGC through raw vtables and the console display state.
# A C# fragment of the partial class SpN; sp-n.ps1 compiles every sp-n-native-*.ps1 together.
$SpNNative += @'
public static partial class SpN {
  // ---------------------------------------------------------------- pixels
  public class Frame { public int W, H; public byte[] Bgra; }
  public static Hashtable Classify(Frame f) {
    var h = H();
    if (f == null) { h["class"] = "null_frame"; return h; }
    long sampled = 0, black = 0;
    for (long i = 0; i < (long)f.W * f.H; i += 4) {
      long o = i * 4; sampled++;
      if (f.Bgra[o] <= 16 && f.Bgra[o + 1] <= 16 && f.Bgra[o + 2] <= 16) black++;
    }
    double frac = sampled == 0 ? 1 : (double)black / sampled;
    h["w"] = f.W; h["h"] = f.H; h["nearBlack"] = Math.Round(frac, 4);
    h["class"] = frac >= 0.98 ? "black_frame" : "frame";
    return h;
  }
  // Fraction of pixels inside [x0,y0,x1,y1) (frame coordinates) that are the overlay's magenta.
  public static double Magenta(Frame f, int x0, int y0, int x1, int y1) {
    if (f == null) return -1;
    long n = 0, m = 0;
    for (int y = Math.Max(0, y0); y < Math.Min(f.H, y1); y += 2)
      for (int x = Math.Max(0, x0); x < Math.Min(f.W, x1); x += 2) {
        long o = ((long)y * f.W + x) * 4; n++;
        if (f.Bgra[o + 2] > 200 && f.Bgra[o + 1] < 60 && f.Bgra[o] > 200) m++;
      }
    return n == 0 ? -1 : Math.Round((double)m / n, 4);
  }

  static Frame FromDib(IntPtr bits, int w, int h) {
    var f = new Frame(); f.W = w; f.H = h; f.Bgra = new byte[w * h * 4];
    Marshal.Copy(bits, f.Bgra, 0, f.Bgra.Length); return f;
  }
  static IntPtr Dib(IntPtr dc, int w, int h, out IntPtr bits) {
    var bi = new BITMAPINFOHEADER(); bi.biSize = 40; bi.biWidth = w; bi.biHeight = -h; bi.biPlanes = 1; bi.biBitCount = 32;
    return CreateDIBSection(dc, ref bi, 0, out bits, IntPtr.Zero, 0);
  }

  // PrintWindow(PW_RENDERFULLCONTENT) cropped to the extended frame bounds inset 1 px.
  public static Frame PrintWin(IntPtr hwnd, out bool ok, out int err, out RECT frameOnScreen) {
    RECT wr; GetWindowRect(hwnd, out wr);
    RECT ext; if (DwmGetWindowAttribute(hwnd, 9, out ext, 16) != 0) ext = wr;
    frameOnScreen = ext;
    int w = wr.Right - wr.Left, h = wr.Bottom - wr.Top;
    ok = false; err = 0;
    if (w <= 0 || h <= 0) return null;
    IntPtr screen = GetDC(IntPtr.Zero), mem = CreateCompatibleDC(screen), bits;
    IntPtr bmp = Dib(screen, w, h, out bits), old = SelectObject(mem, bmp);
    ok = PrintWindow(hwnd, mem, 2); err = Marshal.GetLastWin32Error();
    Frame full = ok ? FromDib(bits, w, h) : null;
    SelectObject(mem, old); DeleteObject(bmp); DeleteDC(mem); ReleaseDC(IntPtr.Zero, screen);
    if (full == null) return null;
    int cx0 = ext.Left - wr.Left + 1, cy0 = ext.Top - wr.Top + 1, cw = ext.Right - ext.Left - 2, ch = ext.Bottom - ext.Top - 2;
    if (cw <= 0 || ch <= 0 || cx0 < 0 || cy0 < 0 || cx0 + cw > w || cy0 + ch > h) return full;
    var c = new Frame(); c.W = cw; c.H = ch; c.Bgra = new byte[cw * ch * 4];
    for (int y = 0; y < ch; y++) Buffer.BlockCopy(full.Bgra, ((cy0 + y) * w + cx0) * 4, c.Bgra, y * cw * 4, cw * 4);
    frameOnScreen.Left = ext.Left + 1; frameOnScreen.Top = ext.Top + 1; frameOnScreen.Right = ext.Left + 1 + cw; frameOnScreen.Bottom = ext.Top + 1 + ch;
    return c;
  }

  // Third-party style GDI capture of a screen rectangle (CAPTUREBLT includes layered windows).
  public static Frame ScreenBlt(RECT r) {
    int w = r.Right - r.Left, h = r.Bottom - r.Top;
    IntPtr screen = GetDC(IntPtr.Zero), mem = CreateCompatibleDC(screen), bits;
    IntPtr bmp = Dib(screen, w, h, out bits), old = SelectObject(mem, bmp);
    bool ok = BitBlt(mem, 0, 0, w, h, screen, r.Left, r.Top, 0x00CC0020 | 0x40000000);
    Frame f = ok ? FromDib(bits, w, h) : null;
    SelectObject(mem, old); DeleteObject(bmp); DeleteDC(mem); ReleaseDC(IntPtr.Zero, screen);
    return f;
  }

  // ---------------------------------------------------------------- overlay (layered, UpdateLayeredWindow)
  public static IntPtr Overlay(int x, int y, int w, int h, bool exclude, out bool affOk, out uint affRead) {
    IntPtr hwnd = CreateWindowExW(0x80000 | 0x20 | 0x08000000 | 0x80 | 0x8, "Static", "spn-overlay", 0x80000000, x, y, w, h, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
    IntPtr screen = GetDC(IntPtr.Zero), mem = CreateCompatibleDC(screen), bits;
    IntPtr bmp = Dib(screen, w, h, out bits), old = SelectObject(mem, bmp);
    var px = new byte[w * h * 4];
    for (int i = 0; i < w * h; i++) { px[i * 4] = 255; px[i * 4 + 1] = 0; px[i * 4 + 2] = 255; px[i * 4 + 3] = 255; }
    Marshal.Copy(px, 0, bits, px.Length);
    var dst = new POINT(); dst.X = x; dst.Y = y; var sz = new SIZE(); sz.Cx = w; sz.Cy = h; var src = new POINT();
    var bf = new BLENDFUNCTION(); bf.BlendOp = 0; bf.SourceConstantAlpha = 255; bf.AlphaFormat = 1;
    UpdateLayeredWindow(hwnd, screen, ref dst, ref sz, mem, ref src, 0, ref bf, 2);
    SelectObject(mem, old); DeleteObject(bmp); DeleteDC(mem); ReleaseDC(IntPtr.Zero, screen);
    affOk = true; affRead = 0;
    if (exclude) affOk = SetWindowDisplayAffinity(hwnd, 0x11);
    GetWindowDisplayAffinity(hwnd, out affRead);
    ShowWindow(hwnd, 4);
    SetWindowPos(hwnd, (IntPtr)(-1), x, y, w, h, 0x10 | 0x40);
    Pump(300); DwmFlush(); DwmFlush();
    return hwnd;
  }
  public static void Pump(int ms) {
    var sw = Stopwatch.StartNew(); MSG m;
    while (sw.ElapsedMilliseconds < ms) { while (PeekMessageW(out m, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref m); DispatchMessageW(ref m); } Thread.Sleep(5); }
  }

  // ---------------------------------------------------------------- Windows.Graphics.Capture through raw vtables
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int FnOutByte(IntPtr self, out byte b);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int FnCreateFor(IntPtr self, IntPtr h, ref Guid iid, out IntPtr o);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int FnOutSize(IntPtr self, out SizeInt32 s);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int FnCreatePool(IntPtr self, IntPtr device, int fmt, int n, SizeInt32 size, out IntPtr pool);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int FnOutPtr(IntPtr self, out IntPtr o);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int FnInPtrOutPtr(IntPtr self, IntPtr i, out IntPtr o);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int FnVoid(IntPtr self);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int FnGetIface(IntPtr self, ref Guid iid, out IntPtr o);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void FnGetDesc(IntPtr self, out TEX2DDESC d);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int FnCreateTex(IntPtr self, ref TEX2DDESC d, IntPtr init, out IntPtr t);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void FnCopy(IntPtr self, IntPtr dst, IntPtr src);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int FnMap(IntPtr self, IntPtr res, uint sub, int type, uint flags, out MAPPED m);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void FnUnmap(IntPtr self, IntPtr res, uint sub);

  static T Slot<T>(IntPtr o, int i) where T : class {
    IntPtr vt = Marshal.ReadIntPtr(o);
    return (T)(object)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(vt, i * IntPtr.Size), typeof(T));
  }
  static IntPtr Factory(string cls, Guid iid) {
    IntPtr hs; WindowsCreateString(cls, cls.Length, out hs);
    IntPtr f; int hr = RoGetActivationFactory(hs, ref iid, out f);
    WindowsDeleteString(hs);
    if (hr != 0) throw new Exception("RoGetActivationFactory " + cls + " 0x" + hr.ToString("X8"));
    return f;
  }
  static readonly Guid IID_Interop = new Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356");
  static readonly Guid IID_Item = new Guid("79C3F95B-31F7-4EC2-A464-632EF5D30760");
  static readonly Guid IID_SessionStatics = new Guid("2224A540-5974-49AA-B232-0882536F4CB5");
  static readonly Guid IID_PoolStatics2 = new Guid("589B103F-6BBC-5DF5-A991-02E28B3B66D5");
  static readonly Guid IID_DxgiAccess = new Guid("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1");
  static readonly Guid IID_Tex2D = new Guid("6f15aaf2-d208-4e89-9ab4-489535d34f9c");
  static readonly Guid IID_DxgiDevice = new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c");
  static readonly Guid IID_Closable = new Guid("30D5A829-7FA4-4026-83BB-D75BAE4EA99E");

  static void RunMta(ThreadStart f) {
    Exception err = null;
    var t = new Thread(delegate () { try { RoInitialize(1); f(); } catch (Exception e) { err = e; } });
    t.SetApartmentState(ApartmentState.MTA); t.Start(); t.Join();
    if (err != null) throw err;
  }

  public static Hashtable IsSupported() {
    var h = H();
    RunMta(delegate () {
      IntPtr f = Factory("Windows.Graphics.Capture.GraphicsCaptureSession", IID_SessionStatics);
      byte b; int hr = Slot<FnOutByte>(f, 6)(f, out b);
      h["hresult"] = hr; h["isSupported"] = b != 0; Marshal.Release(f);
    });
    h["sessionId"] = OwnSession();
    return h;
  }

  static void Close(IntPtr o) {
    if (o == IntPtr.Zero) return;
    IntPtr c; Guid g = IID_Closable;
    if (Marshal.QueryInterface(o, ref g, out c) == 0) { Slot<FnVoid>(c, 6)(c); Marshal.Release(c); }
    Marshal.Release(o);
  }

  // One WGC capture of a monitor (hwnd = IntPtr.Zero, hmon set) or a window.
  // Returns the first frame within timeoutMs, or null with the reason in info.
  public static Frame Wgc(IntPtr hwnd, IntPtr hmon, int timeoutMs, Hashtable info) {
    Frame result = null;
    RunMta(delegate () {
      IntPtr dev = IntPtr.Zero, ctx = IntPtr.Zero, dxgi = IntPtr.Zero, winrtDev = IntPtr.Zero, interop = IntPtr.Zero, item = IntPtr.Zero, poolF = IntPtr.Zero, pool = IntPtr.Zero, session = IntPtr.Zero;
      try {
        int level; int hr = D3D11CreateDevice(IntPtr.Zero, 1, IntPtr.Zero, 0x20, IntPtr.Zero, 0, 7, out dev, out level, out ctx);
        info["d3dDriver"] = "hardware";
        if (hr != 0) { hr = D3D11CreateDevice(IntPtr.Zero, 5, IntPtr.Zero, 0x20, IntPtr.Zero, 0, 7, out dev, out level, out ctx); info["d3dDriver"] = "warp"; }
        if (hr != 0) { info["error"] = "D3D11CreateDevice 0x" + hr.ToString("X8"); return; }
        Guid g = IID_DxgiDevice; Marshal.QueryInterface(dev, ref g, out dxgi);
        hr = CreateDirect3D11DeviceFromDXGIDevice(dxgi, out winrtDev);
        if (hr != 0) { info["error"] = "CreateDirect3D11DeviceFromDXGIDevice 0x" + hr.ToString("X8"); return; }
        interop = Factory("Windows.Graphics.Capture.GraphicsCaptureItem", IID_Interop);
        Guid gi = IID_Item;
        hr = hwnd != IntPtr.Zero ? Slot<FnCreateFor>(interop, 3)(interop, hwnd, ref gi, out item) : Slot<FnCreateFor>(interop, 4)(interop, hmon, ref gi, out item);
        info["createHresult"] = "0x" + hr.ToString("X8");
        if (hr != 0) { info["error"] = "CreateFor" + (hwnd != IntPtr.Zero ? "Window" : "Monitor") + " 0x" + hr.ToString("X8"); return; }
        SizeInt32 size; Slot<FnOutSize>(item, 7)(item, out size);
        info["itemW"] = size.Width; info["itemH"] = size.Height;
        poolF = Factory("Windows.Graphics.Capture.Direct3D11CaptureFramePool", IID_PoolStatics2);
        hr = Slot<FnCreatePool>(poolF, 6)(poolF, winrtDev, 87, 2, size, out pool);
        if (hr != 0) { info["error"] = "CreateFreeThreaded 0x" + hr.ToString("X8"); return; }
        hr = Slot<FnInPtrOutPtr>(pool, 10)(pool, item, out session);
        if (hr != 0) { info["error"] = "CreateCaptureSession 0x" + hr.ToString("X8"); return; }
        hr = Slot<FnVoid>(session, 6)(session);
        info["startHresult"] = "0x" + hr.ToString("X8");
        if (hr != 0) { info["error"] = "StartCapture 0x" + hr.ToString("X8"); return; }
        var sw = Stopwatch.StartNew(); IntPtr frame = IntPtr.Zero;
        while (sw.ElapsedMilliseconds < timeoutMs) {
          hr = Slot<FnOutPtr>(pool, 7)(pool, out frame);
          if (hr == 0 && frame != IntPtr.Zero) break;
          Thread.Sleep(5);
        }
        info["waitMs"] = sw.ElapsedMilliseconds;
        if (frame == IntPtr.Zero) { info["error"] = "no frame within " + timeoutMs + " ms"; return; }
        IntPtr surface; Slot<FnOutPtr>(frame, 6)(frame, out surface);
        IntPtr access; Guid ga = IID_DxgiAccess; Marshal.QueryInterface(surface, ref ga, out access);
        IntPtr tex; Guid gt = IID_Tex2D; Slot<FnGetIface>(access, 3)(access, ref gt, out tex);
        TEX2DDESC d; Slot<FnGetDesc>(tex, 10)(tex, out d);
        var sd = d; sd.MipLevels = 1; sd.ArraySize = 1; sd.SampleCount = 1; sd.SampleQuality = 0; sd.Usage = 3; sd.BindFlags = 0; sd.CPUAccessFlags = 0x20000; sd.MiscFlags = 0;
        IntPtr staging; hr = Slot<FnCreateTex>(dev, 5)(dev, ref sd, IntPtr.Zero, out staging);
        if (hr != 0) { info["error"] = "CreateTexture2D 0x" + hr.ToString("X8"); return; }
        Slot<FnCopy>(ctx, 47)(ctx, staging, tex);
        MAPPED m; hr = Slot<FnMap>(ctx, 14)(ctx, staging, 0, 1, 0, out m);
        if (hr != 0) { info["error"] = "Map 0x" + hr.ToString("X8"); return; }
        var f = new Frame(); f.W = (int)d.Width; f.H = (int)d.Height; f.Bgra = new byte[f.W * f.H * 4];
        for (int y = 0; y < f.H; y++) Marshal.Copy(new IntPtr(m.pData.ToInt64() + (long)y * m.RowPitch), f.Bgra, y * f.W * 4, f.W * 4);
        Slot<FnUnmap>(ctx, 15)(ctx, staging, 0);
        Marshal.Release(staging); Marshal.Release(tex); Marshal.Release(access); Marshal.Release(surface); Close(frame);
        result = f;
      } finally {
        Close(session); Close(pool);
        foreach (IntPtr p in new IntPtr[] { poolF, item, interop, winrtDev, dxgi, ctx, dev }) if (p != IntPtr.Zero) Marshal.Release(p);
      }
    });
    return result;
  }

  // ---------------------------------------------------------------- console display state
  static readonly Guid GUID_CONSOLE_DISPLAY_STATE = new Guid("6FE69556-704A-47A0-8F24-C28D936FDA47");
  public static int DisplayState = -1;
  static PowerCallback keep;
  public static IntPtr WatchDisplay() {
    keep = delegate (IntPtr ctx, uint type, IntPtr setting) {
      if (type == 0x8013 && setting != IntPtr.Zero) DisplayState = Marshal.ReadInt32(setting, 20);
      return 0;
    };
    var s = new SUBSCRIBE(); s.Callback = keep; s.Context = IntPtr.Zero;
    Guid g = GUID_CONSOLE_DISPLAY_STATE; IntPtr h;
    PowerSettingRegisterNotification(ref g, 2, ref s, out h);
    return h;
  }
  public static void MonitorPower(int state) { PostMessageW((IntPtr)0xFFFF, WM_SYSCOMMAND, (IntPtr)0xF170, (IntPtr)state); }

}
'@
