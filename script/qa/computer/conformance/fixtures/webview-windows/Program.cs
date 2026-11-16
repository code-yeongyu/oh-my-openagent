using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ConformanceFixtureWeb
{
    // Usage: ConformanceFixtureWeb.exe --report <path>. A WebView2 host of the shared page (web\ beside the exe)
    // with native menus; same report and stdin control protocol as native-linux/fixture.py.
    public sealed class Host
    {
        private static readonly string Bridge =
            "window.conformanceHost = { hideA11y: " + (Environment.GetEnvironmentVariable("CONFORMANCE_FIXTURE_SABOTAGE") == "a11y" ? "true" : "false") + ", post: (json) => window.chrome.webview.postMessage(json) }";
        private readonly string reportPath;
        private readonly string sabotage = Environment.GetEnvironmentVariable("CONFORMANCE_FIXTURE_SABOTAGE") ?? "";
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private readonly Dictionary<WebView2, Dictionary<string, object>> states = new Dictionary<WebView2, Dictionary<string, object>>();
        private Dictionary<string, object> initialFields;
        private Dictionary<string, object> initialSaved;
        public readonly List<Form> Windows = new List<Form>();
        public readonly List<WebView2> Views = new List<WebView2>();
        public readonly string DataDir = Path.Combine(Path.GetTempPath(), "conformance-fixture-web-" + Process.GetCurrentProcess().Id);
        private readonly string appKey = AppUserModelId.Set("dev.omo.conformance-fixture.webview");

        public Host(string reportPath)
        {
            this.reportPath = reportPath;
        }

        public async Task OpenWindow()
        {
            int number = Windows.Count + 1;
            var form = new Form { Text = number == 1 ? "Conformance Document" : "Conformance Document " + number, ClientSize = new Size(640, 720) };
            var view = new WebView2 { Dock = DockStyle.Fill };
            form.Controls.Add(view);
            form.MainMenuStrip = BuildMenu(form);
            form.Controls.Add(form.MainMenuStrip);
            Windows.Add(form);
            Views.Add(view);
            form.Show();
            string data = DataDir;
            // The baseline run (43237342972) found the page absent from the UIA tree: with no assistive client
            // detected, the WebView2 renderer ships no accessibility tree. Force it on so the UIA probe sees
            // the page's controls.
            var options = new CoreWebView2EnvironmentOptions { AdditionalBrowserArguments = "--force-renderer-accessibility" };
            var environment = await CoreWebView2Environment.CreateAsync(null, data, options);
            await view.EnsureCoreWebView2Async(environment);
            await view.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(Bridge);
            view.CoreWebView2.WebMessageReceived += (sender, args) => Remember(view, args.TryGetWebMessageAsString());
            var loaded = new TaskCompletionSource<bool>();
            view.CoreWebView2.NavigationCompleted += (sender, args) => loaded.TrySetResult(args.IsSuccess);
            view.CoreWebView2.Navigate(new Uri(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "web", "index.html")).AbsoluteUri);
            if (!await loaded.Task) throw new InvalidOperationException("the fixture page did not load");
            await Evaluate(view, "conformance.state()");
        }

        private MenuStrip BuildMenu(Form form)
        {
            var strip = new MenuStrip();
            var menus = new[]
            {
                new KeyValuePair<string, string[]>("File", new[] { "Save", "Rename…", "New Window" }),
                new KeyValuePair<string, string[]>("Edit", new[] { "Undo" }),
                new KeyValuePair<string, string[]>("Priority", new[] { "Low", "Normal", "High" }),
                new KeyValuePair<string, string[]>("Test", new[] { "Conformance" }),
            };
            foreach (var menu in menus)
            {
                var top = new ToolStripMenuItem(menu.Key);
                foreach (string label in menu.Value)
                {
                    string path = menu.Key + "/" + label;
                    var item = new ToolStripMenuItem(label);
                    item.Click += async (sender, args) => await Menu(path, Views[Windows.IndexOf(form)]);
                    top.DropDownItems.Add(item);
                }
                strip.Items.Add(top);
            }
            return strip;
        }

        private void Remember(WebView2 view, string stateJson)
        {
            states[view] = json.Deserialize<Dictionary<string, object>>(stateJson);
            WriteReport();
        }

        public async Task Evaluate(WebView2 view, string script)
        {
            string result = await view.CoreWebView2.ExecuteScriptAsync("JSON.stringify(" + script + ")");
            string stateJson = json.Deserialize<string>(result);
            if (stateJson == null) throw new InvalidOperationException("the page returned no state for " + script);
            Remember(view, stateJson);
        }

        public async Task Menu(string path, WebView2 view)
        {
            if (path == "File/New Window")
            {
                await OpenWindow();
                WriteReport();
                return;
            }
            await Evaluate(view, "conformance.menu(" + json.Serialize(path) + ")");
        }

        public async Task<string> Control(string line)
        {
            string[] words = line.Split(new[] { ' ' }, 2);
            string rest = words.Length == 2 ? words[1] : "";
            if (words[0] == "poke") await Evaluate(Views[0], "conformance.poke(" + json.Serialize(rest) + ")");
            else if (words[0] == "menu") await Menu(rest, Views[0]);
            else if (words[0] == "set")
            {
                string[] field = rest.Split(new[] { ' ' }, 2);
                string text = field.Length == 2 ? field[1] : "";
                await Evaluate(Views[0], "conformance.set(" + json.Serialize(field[0]) + ", " + json.Serialize(text) + ")");
            }
            else throw new ArgumentException("unknown control line " + line);
            return "OK " + line;
        }

        private void WriteReport()
        {
            Dictionary<string, object> main;
            if (Views.Count == 0 || !states.TryGetValue(Views[0], out main)) return;
            var fields = new Dictionary<string, object>((Dictionary<string, object>)main["fields"]);
            var saved = new Dictionary<string, object>((Dictionary<string, object>)main["saved"]);
            int savedDocuments = 0;
            foreach (WebView2 view in Views)
            {
                Dictionary<string, object> state;
                if (states.TryGetValue(view, out state) && true.Equals(state["savedOnce"])) savedDocuments += 1;
            }
            saved["savedDocuments"] = savedDocuments;
            if (initialFields == null)
            {
                initialFields = new Dictionary<string, object>(fields);
                initialSaved = new Dictionary<string, object>(saved);
            }
            if (fields.ContainsKey(sabotage)) fields[sabotage] = initialFields[sabotage];
            if (saved.ContainsKey(sabotage)) saved[sabotage] = initialSaved[sabotage];
            var titles = new List<string>();
            foreach (Form form in Windows) titles.Add(form.Text);
            var report = new SortedDictionary<string, object>(StringComparer.Ordinal)
            {
                { "schema", "omo-conformance-fixture/1" },
                { "app", "Conformance Fixture" },
                { "toolkit", "webview" },
                { "windows", titles },
                { "appKey", appKey },
                { "fields", new SortedDictionary<string, object>(fields, StringComparer.Ordinal) },
                { "saved", new SortedDictionary<string, object>(saved, StringComparer.Ordinal) },
            };
            string temporary = reportPath + ".tmp";
            File.WriteAllText(temporary, json.Serialize(report) + "\n", new UTF8Encoding(false));
            if (File.Exists(reportPath)) File.Replace(temporary, reportPath, null);
            else File.Move(temporary, reportPath);
        }
    }

    public static class Program
    {
        [STAThread]
        public static int Main(string[] args)
        {
            if (args.Length != 2 || args[0] != "--report")
            {
                Console.Error.WriteLine("usage: ConformanceFixtureWeb.exe --report <path>");
                return 2;
            }
            Console.Out.NewLine = "\n";
            Application.EnableVisualStyles();
            host = new Host(args[1]);
            Application.Idle += Start;
            Application.Run(new ApplicationContext());
            // The WebView2 user-data folder is this fixture's own; remove it once the browser processes let go.
            foreach (WebView2 view in host.Views) view.Dispose();
            for (int attempt = 0; attempt < 20 && Directory.Exists(host.DataDir); attempt++)
            {
                try { Directory.Delete(host.DataDir, true); }
                catch (IOException) { Thread.Sleep(250); }
                catch (UnauthorizedAccessException) { Thread.Sleep(250); }
            }
            return 0;
        }

        private static Host host;

        private static async void Start(object sender, EventArgs e)
        {
            Application.Idle -= Start;
            try
            {
                await host.OpenWindow();
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("fixture: " + error.Message);
                Application.Exit();
                return;
            }
            Console.Out.WriteLine("READY pid=" + Process.GetCurrentProcess().Id);
            Console.Out.Flush();
            var ui = SynchronizationContext.Current;
            new Thread(() => ReadControl(host, ui)) { IsBackground = true }.Start();
        }

        private static void ReadControl(Host fixture, SynchronizationContext ui)
        {
            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                if (line.Length == 0) continue;
                if (line == "quit") break;
                var answer = new TaskCompletionSource<string>();
                ui.Post(async state =>
                {
                    try { answer.SetResult(await fixture.Control(line)); }
                    catch (Exception error) { answer.SetResult("ERR " + error.Message); }
                }, null);
                Console.Out.WriteLine(answer.Task.Result);
                Console.Out.Flush();
            }
            ui.Post(state => Application.Exit(), null);
        }
    }
}

namespace ConformanceFixtureWeb
{
    public static class AppUserModelId
    {
        [System.Runtime.InteropServices.DllImport("shell32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, PreserveSig = false)]
        private static extern void SetCurrentProcessExplicitAppUserModelID(string id);

        [System.Runtime.InteropServices.DllImport("shell32.dll", PreserveSig = false)]
        private static extern void GetCurrentProcessExplicitAppUserModelID(out System.IntPtr id);

        public static string Set(string id)
        {
            SetCurrentProcessExplicitAppUserModelID(id);
            System.IntPtr read;
            GetCurrentProcessExplicitAppUserModelID(out read);
            try { return System.Runtime.InteropServices.Marshal.PtrToStringUni(read); }
            finally { System.Runtime.InteropServices.Marshal.FreeCoTaskMem(read); }
        }
    }
}
