using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Windows.Forms;

namespace ConformanceFixture
{
    // Usage: ConformanceFixture.exe --report <path>. Same report and stdin control protocol as the Linux
    // fixture (native-linux/fixture.py): READY pid=<pid>, then poke/set/menu/quit lines answered by OK or ERR.
    public sealed class Fixture
    {
        private readonly string reportPath;
        private readonly string sabotage = Environment.GetEnvironmentVariable("CONFORMANCE_FIXTURE_SABOTAGE") ?? "";
        public readonly List<DocumentForm> Windows = new List<DocumentForm>();
        private SortedDictionary<string, object> initial;

        public Fixture(string reportPath)
        {
            this.reportPath = reportPath;
            OpenWindow();
            initial = Report.Snapshot(Windows);
            WriteReport();
        }

        public void OpenWindow()
        {
            var window = new DocumentForm(this, Windows.Count + 1);
            Windows.Add(window);
            if (Windows.Count > 1)
            {
                window.Show();
                Changed();
            }
        }

        public void Changed()
        {
            if (initial != null) WriteReport();
        }

        public void WriteReport()
        {
            SortedDictionary<string, object> report = Report.Snapshot(Windows);
            if (sabotage.Length > 0) Report.Pin(report, initial, sabotage);
            Report.Write(reportPath, report);
        }

        public void Poke(string action)
        {
            DocumentForm main = Windows[0];
            switch (action)
            {
                case "click":
                case "ax.perform": main.Press.PerformClick(); break;
                case "typeText": main.Fields["Value"].AppendText("conformance"); break;
                case "ax.setValue": main.Fields.Set("Value", "conformance"); break;
                case "keyChord": main.PokeChord(Keys.Control | Keys.K); break;
                case "scroll": main.ScrollPad.PokeWheelDown(3); break;
                case "drag": main.Drag.PokeDrag("b", "a"); break;
                case "menu.select": main.MenuItems["Test/Conformance"].PerformClick(); break;
                default: throw new ArgumentException("unknown action " + action);
            }
        }

        public string Control(string line)
        {
            DocumentForm main = Windows[0];
            string[] words = line.Split(new[] { ' ' }, 2);
            if (words[0] == "poke" && words.Length == 2) Poke(words[1]);
            else if (words[0] == "menu" && words.Length == 2) main.MenuItems[words[1]].PerformClick();
            else if (words[0] == "set" && words.Length == 2)
            {
                string[] rest = words[1].Split(new[] { ' ' }, 2);
                main.Fields.Set(rest[0], rest.Length == 2 ? rest[1] : "");
            }
            else throw new ArgumentException("unknown control line " + line);
            WriteReport();
            return "OK " + line;
        }
    }

    public static class Program
    {
        [STAThread]
        public static int Main(string[] args)
        {
            if (args.Length != 2 || args[0] != "--report")
            {
                Console.Error.WriteLine("usage: ConformanceFixture.exe --report <path>");
                return 2;
            }
            Application.EnableVisualStyles();
            var fixture = new Fixture(args[1]);
            DocumentForm main = fixture.Windows[0];
            main.Shown += delegate
            {
                Console.Out.WriteLine("READY pid=" + Process.GetCurrentProcess().Id);
                Console.Out.Flush();
                new Thread(() => ReadControl(fixture, main)) { IsBackground = true }.Start();
            };
            Application.Run(main);
            return 0;
        }

        private static void ReadControl(Fixture fixture, DocumentForm main)
        {
            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                if (line.Length == 0) continue;
                if (line == "quit") break;
                string answer = (string)main.Invoke(new Func<string>(delegate
                {
                    try { return fixture.Control(line); }
                    catch (Exception error) { return "ERR " + error.Message; }
                }));
                Console.Out.WriteLine(answer);
                Console.Out.Flush();
            }
            main.BeginInvoke(new Action(Application.Exit));
        }
    }
}
