using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace ConformanceFixture
{
    public static class Report
    {
        public const string Schema = "omo-conformance-fixture/1";

        public static SortedDictionary<string, object> Snapshot(List<DocumentForm> windows, string appKey)
        {
            DocumentForm main = windows[0];
            var fields = new SortedDictionary<string, object>(StringComparer.Ordinal)
            {
                { "value", main.Fields.Text("Value") },
                { "receivedKeys", string.Join(",", main.Chords) },
                { "pressCount", main.PressCount },
                { "scrollSteps", main.ScrollPad.Steps },
                { "dragOrder", main.Drag.Order },
                { "menuSelection", main.MenuSelection },
            };
            var saved = new SortedDictionary<string, object>(main.Saved, StringComparer.Ordinal);
            saved["savedDocuments"] = windows.FindAll(window => window.SavedOnce).Count;
            return new SortedDictionary<string, object>(StringComparer.Ordinal)
            {
                { "schema", Schema },
                { "app", DocumentForm.App },
                { "toolkit", "native" },
                { "windows", windows.ConvertAll(window => window.Text) },
                { "appKey", appKey },
                { "fields", fields },
                { "saved", saved },
            };
        }

        public static void Pin(SortedDictionary<string, object> report, SortedDictionary<string, object> initial, string field)
        {
            foreach (string section in new[] { "fields", "saved" })
            {
                var current = (SortedDictionary<string, object>)report[section];
                if (current.ContainsKey(field)) current[field] = ((SortedDictionary<string, object>)initial[section])[field];
            }
        }

        public static void Write(string path, SortedDictionary<string, object> report)
        {
            var text = new StringBuilder();
            Append(text, report);
            text.Append('\n');
            string temporary = path + ".tmp";
            File.WriteAllText(temporary, text.ToString(), new UTF8Encoding(false));
            if (File.Exists(path)) File.Replace(temporary, path, null);
            else File.Move(temporary, path);
        }

        private static void Append(StringBuilder text, object value)
        {
            var map = value as SortedDictionary<string, object>;
            if (map != null)
            {
                text.Append('{');
                bool first = true;
                foreach (KeyValuePair<string, object> entry in map)
                {
                    if (!first) text.Append(',');
                    first = false;
                    Append(text, entry.Key);
                    text.Append(':');
                    Append(text, entry.Value);
                }
                text.Append('}');
            }
            else if (value is string) AppendString(text, (string)value);
            else if (value is List<string>)
            {
                text.Append('[');
                var items = (List<string>)value;
                for (int i = 0; i < items.Count; i++)
                {
                    if (i > 0) text.Append(',');
                    AppendString(text, items[i]);
                }
                text.Append(']');
            }
            else if (value is bool) text.Append((bool)value ? "true" : "false");
            else if (value is int) text.Append(((int)value).ToString(System.Globalization.CultureInfo.InvariantCulture));
            else throw new ArgumentException("cannot write " + value.GetType().Name + " to the report");
        }

        private static void AppendString(StringBuilder text, string value)
        {
            text.Append('"');
            foreach (char c in value)
            {
                if (c == '"' || c == '\\') text.Append('\\').Append(c);
                else if (c == '\n') text.Append("\\n");
                else if (c == '\r') text.Append("\\r");
                else if (c == '\t') text.Append("\\t");
                else if (c < ' ') text.Append("\\u").Append(((int)c).ToString("x4"));
                else text.Append(c);
            }
            text.Append('"');
        }
    }
}
