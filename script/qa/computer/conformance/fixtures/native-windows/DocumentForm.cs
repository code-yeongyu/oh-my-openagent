using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;

namespace ConformanceFixture
{
    public sealed class DocumentForm : Form
    {
        public const string App = "Conformance Fixture";
        private const int LongRows = 60;
        private readonly Fixture fixture;
        private readonly FlowLayoutPanel body = new FlowLayoutPanel();
        public readonly Dictionary<string, ToolStripMenuItem> MenuItems = new Dictionary<string, ToolStripMenuItem>();
        public readonly List<string> Chords = new List<string>();
        public readonly List<string> Items = new List<string>();
        public readonly TextFields Fields;
        public readonly Button Press;
        public readonly CheckBox Archived = new CheckBox { Text = "Archived", AccessibleName = "Archived", AutoSize = true };
        public readonly ScrollTarget ScrollPad = new ScrollTarget();
        public readonly DragList Drag = new DragList();
        private readonly ListBox longList = new ListBox { AccessibleName = "Rows", Height = 160, IntegralHeight = false };
        public int PressCount;
        public string MenuSelection = "";
        public string Priority = "";
        public string DocumentName = "Document";
        public int DoneRow;
        public bool SavedOnce;
        public SortedDictionary<string, object> Saved;

        public DocumentForm(Fixture fixture, int number)
        {
            this.fixture = fixture;
            Fields = new TextFields(fixture.Changed);
            Text = number == 1 ? "Conformance Document" : "Conformance Document " + number;
            ClientSize = new Size(640, 720);
            KeyPreview = true;
            KeyDown += OnChord;
            MainMenuStrip = BuildMenu();
            body.Dock = DockStyle.Fill;
            body.FlowDirection = FlowDirection.TopDown;
            body.WrapContents = false;
            body.AutoScroll = true;
            Controls.Add(body);
            Controls.Add(MainMenuStrip);

            Press = AddButton("Press", delegate { PressCount += 1; fixture.Changed(); });
            foreach (string label in new[] { "Value", "Title", "Name", "Email", "City" }) AddField(label, false);
            Archived.CheckedChanged += delegate { fixture.Changed(); };
            body.Controls.Add(Archived);
            AddField("Note", true);
            AddField("New item", false);
            AddButton("Add", OnAddItem);
            ScrollPad.Width = 600;
            ScrollPad.Changed += fixture.Changed;
            body.Controls.Add(ScrollPad);
            Drag.Width = 600;
            Drag.Changed += fixture.Changed;
            body.Controls.Add(Drag);
            longList.Width = 600;
            for (int row = 1; row <= LongRows; row++) longList.Items.Add("Row " + row);
            body.Controls.Add(longList);
            AddButton("Mark done", OnMarkDone);
            Saved = DocumentState();
        }

        private MenuStrip BuildMenu()
        {
            var strip = new MenuStrip();
            AddMenu(strip, "File", new[] { "Save", "Rename…", "New Window" }, new Action[] { OnSave, OnRename, fixture.OpenWindow });
            AddMenu(strip, "Edit", new[] { "Undo" }, new Action[] { Fields.Undo });
            var priorities = new[] { "Low", "Normal", "High" };
            AddMenu(strip, "Priority", priorities, Array.ConvertAll(priorities, name => (Action)delegate { Priority = name; fixture.Changed(); }));
            AddMenu(strip, "Test", new[] { "Conformance" }, new Action[] { delegate { MenuSelection = "Conformance"; fixture.Changed(); } });
            return strip;
        }

        private void AddMenu(MenuStrip strip, string title, string[] labels, Action[] handlers)
        {
            var top = new ToolStripMenuItem(title);
            for (int i = 0; i < labels.Length; i++)
            {
                Action handler = handlers[i];
                var item = new ToolStripMenuItem(labels[i]);
                item.Click += delegate { handler(); };
                top.DropDownItems.Add(item);
                MenuItems[title + "/" + labels[i]] = item;
            }
            strip.Items.Add(top);
        }

        private Button AddButton(string label, Action handler)
        {
            var button = new Button { Text = label, AccessibleName = label, AutoSize = true };
            button.Click += delegate { handler(); };
            body.Controls.Add(button);
            return button;
        }

        private void AddField(string label, bool multiline)
        {
            body.Controls.Add(new Label { Text = label, AutoSize = true });
            var box = new TextBox { AccessibleName = label, Width = 600, Multiline = multiline, AcceptsReturn = multiline };
            if (multiline) box.Height = 60;
            body.Controls.Add(box);
            Fields.Track(label, box);
        }

        private void OnChord(object sender, KeyEventArgs e)
        {
            bool modifierKey = e.KeyCode == Keys.ControlKey || e.KeyCode == Keys.Menu || e.KeyCode == Keys.ShiftKey;
            if (modifierKey || (!e.Control && !e.Alt)) return;
            var parts = new List<string>();
            if (e.Control) parts.Add("ctrl");
            if (e.Alt) parts.Add("alt");
            if (e.Shift) parts.Add("shift");
            parts.Add(e.KeyCode.ToString().ToLowerInvariant());
            Chords.Add(string.Join("+", parts));
            fixture.Changed();
        }

        public void PokeChord(Keys keys)
        {
            OnKeyDown(new KeyEventArgs(keys));
        }

        private void OnAddItem()
        {
            string text = Fields.Text("New item");
            if (text.Length > 0)
            {
                Items.Add(text);
                Fields.Set("New item", "");
            }
            fixture.Changed();
        }

        private void OnMarkDone()
        {
            if (longList.SelectedIndex < 0) return;
            DoneRow = longList.SelectedIndex + 1;
            fixture.Changed();
        }

        private void OnSave()
        {
            Saved = DocumentState();
            SavedOnce = true;
            fixture.Changed();
        }

        private void OnRename()
        {
            var dialog = new Form { Text = "Rename", Owner = this, ClientSize = new Size(320, 90), StartPosition = FormStartPosition.CenterParent };
            var entry = new TextBox { AccessibleName = "New name", Location = new Point(8, 8), Width = 300 };
            var button = new Button { Text = "Rename", AccessibleName = "Rename", Location = new Point(8, 40), AutoSize = true };
            button.Click += delegate
            {
                if (entry.Text.Length > 0) DocumentName = entry.Text;
                dialog.Close();
                fixture.Changed();
            };
            dialog.Controls.Add(entry);
            dialog.Controls.Add(button);
            dialog.Show(this);
        }

        public SortedDictionary<string, object> DocumentState()
        {
            return new SortedDictionary<string, object>(StringComparer.Ordinal)
            {
                { "title", Fields.Text("Title") },
                { "name", Fields.Text("Name") },
                { "email", Fields.Text("Email") },
                { "city", Fields.Text("City") },
                { "archived", Archived.Checked },
                { "priority", Priority },
                { "order", Drag.Order },
                { "doneRow", DoneRow },
                { "note", Fields.Text("Note") },
                { "documentName", DocumentName },
                { "items", string.Join(",", Items) },
            };
        }
    }
}
