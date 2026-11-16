using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;

namespace ConformanceFixture
{
    // Screen geometry of the main window's widgets for drivers that aim by pixel: keyed by accessible
    // name with the role beside it, captions never emitted, in logical screen points (origin top-left of
    // the virtual desktop; the fixture is DPI-unaware, so Windows reports logical points). "hit" is the
    // part of a widget that answers a click where it differs from the widget's frame.
    public static class Geometry
    {
        private static readonly string[] TextFields = { "Value", "Title", "Name", "Email", "City", "Note", "New item" };

        public static SortedDictionary<string, object> Snapshot(DocumentForm form)
        {
            if (!form.IsHandleCreated || !form.Visible) return null;
            var widgets = new SortedDictionary<string, object>(StringComparer.Ordinal);
            Put(widgets, "Press", "button", Screen(form.Press), null);
            foreach (string label in TextFields) Put(widgets, label, "text", Screen(form.Fields.Widget(label)), null);
            Rectangle archived = Screen(form.Archived);
            Put(widgets, "Archived", "checkbox", archived, archived);
            Put(widgets, "Add", "button", Screen(form.Buttons["Add"]), null);
            Put(widgets, "Mark done", "button", Screen(form.Buttons["Mark done"]), null);
            Put(widgets, "Scroll target", "region", Screen(form.ScrollPad), null);
            foreach (string item in new[] { "a", "b" })
            {
                int index = form.Drag.Items.IndexOf(item);
                if (index < 0) continue;
                Rectangle row = form.Drag.RectangleToScreen(form.Drag.GetItemRectangle(index));
                Put(widgets, item, "list item", row, row);
            }
            foreach (ToolStripItem top in form.MainMenuStrip.Items)
            {
                if (top.Text == "Test") Put(widgets, "Test", "menubar item", form.MainMenuStrip.RectangleToScreen(top.Bounds), null);
            }
            float scale;
            using (Graphics graphics = form.CreateGraphics()) scale = graphics.DpiX / 96f;
            return new SortedDictionary<string, object>(StringComparer.Ordinal)
            {
                { "space", "screen-logical" },
                { "scale", (double)scale },
                { "window", new SortedDictionary<string, object>(StringComparer.Ordinal)
                    {
                        { "client", Rect(form.RectangleToScreen(form.ClientRectangle)) },
                        { "frame", Rect(form.Bounds) },
                    } },
                { "widgets", widgets },
            };
        }

        private static Rectangle Screen(Control control)
        {
            return control.Parent.RectangleToScreen(control.Bounds);
        }

        private static void Put(SortedDictionary<string, object> widgets, string name, string role, Rectangle rect, Rectangle? hit)
        {
            var entry = new SortedDictionary<string, object>(StringComparer.Ordinal) { { "role", role }, { "rect", Rect(rect) } };
            if (hit.HasValue) entry["hit"] = Rect(hit.Value);
            widgets[name] = entry;
        }

        private static SortedDictionary<string, object> Rect(Rectangle rect)
        {
            return new SortedDictionary<string, object>(StringComparer.Ordinal)
            {
                { "x", rect.X }, { "y", rect.Y }, { "width", rect.Width }, { "height", rect.Height },
            };
        }
    }
}
