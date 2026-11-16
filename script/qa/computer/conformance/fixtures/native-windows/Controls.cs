using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;

namespace ConformanceFixture
{
    // Counts discrete wheel notches: one notch down is +1, one notch up is -1.
    public sealed class ScrollTarget : Panel
    {
        public int Steps;
        public event Action Changed;
        private int pendingDelta;

        public ScrollTarget()
        {
            AccessibleName = "Scroll target";
            Height = 40;
            BorderStyle = BorderStyle.FixedSingle;
            Controls.Add(new Label { Text = "Scroll target", AutoSize = true, Location = new Point(4, 4) });
        }

        protected override void OnMouseWheel(MouseEventArgs e)
        {
            base.OnMouseWheel(e);
            pendingDelta -= e.Delta;
            int notches = pendingDelta / SystemInformation.MouseWheelScrollDelta;
            if (notches == 0) return;
            pendingDelta -= notches * SystemInformation.MouseWheelScrollDelta;
            Steps += notches;
            Changed();
        }

        public void PokeWheelDown(int notches)
        {
            for (int i = 0; i < notches; i++)
                OnMouseWheel(new MouseEventArgs(MouseButtons.None, 0, 4, 4, -SystemInformation.MouseWheelScrollDelta));
        }
    }

    // Rows a, b, c reordered by a pointer drag: release over the upper half of a row puts the dragged row
    // before it, the lower half after it.
    public sealed class DragList : ListBox
    {
        public event Action Changed;
        private string source;

        public DragList()
        {
            AccessibleName = "Order";
            Height = 60;
            IntegralHeight = false;
            Items.AddRange(new object[] { "a", "b", "c" });
        }

        public string Order
        {
            get
            {
                var items = new List<string>();
                foreach (object item in Items) items.Add((string)item);
                return string.Join(",", items);
            }
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            int index = IndexFromPoint(e.Location);
            source = e.Button == MouseButtons.Left && index >= 0 ? (string)Items[index] : null;
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            string dragged = source;
            source = null;
            if (e.Button != MouseButtons.Left || dragged == null) return;
            int target = IndexFromPoint(e.Location);
            if (target < 0 || (string)Items[target] == dragged) return;
            Rectangle bounds = GetItemRectangle(target);
            string targetItem = (string)Items[target];
            Items.Remove(dragged);
            int insert = Items.IndexOf(targetItem);
            if (e.Y >= bounds.Top + bounds.Height / 2) insert += 1;
            Items.Insert(insert, dragged);
            Changed();
        }

        public void PokeDrag(string from, string to)
        {
            Rectangle start = GetItemRectangle(Items.IndexOf(from));
            Rectangle end = GetItemRectangle(Items.IndexOf(to));
            OnMouseDown(new MouseEventArgs(MouseButtons.Left, 1, 4, start.Top + 4, 0));
            OnMouseUp(new MouseEventArgs(MouseButtons.Left, 1, 4, end.Top + 1, 0));
        }
    }

    // Edits to one field less than a second apart form one undo group; Undo restores the newest group's
    // field to its text before the group.
    public sealed class TextFields
    {
        private const long UndoGroupMilliseconds = 1000;
        private readonly Dictionary<string, TextBox> widgets = new Dictionary<string, TextBox>();
        private readonly Dictionary<string, string> lastText = new Dictionary<string, string>();
        private readonly Stack<KeyValuePair<string, string>> groups = new Stack<KeyValuePair<string, string>>();
        private readonly Stopwatch clock = Stopwatch.StartNew();
        private readonly Action changed;
        private string lastLabel;
        private long lastAt;
        private bool restoring;

        public TextFields(Action changed)
        {
            this.changed = changed;
        }

        public TextBox Widget(string label)
        {
            return widgets[label];
        }

        public void Track(string label, TextBox box)
        {
            widgets[label] = box;
            lastText[label] = box.Text;
            box.TextChanged += delegate { Edited(label); };
        }

        public TextBox this[string label] { get { return widgets[label]; } }

        public string Text(string label) { return widgets[label].Text.Replace("\r\n", "\n"); }

        public void Set(string label, string text) { widgets[label].Text = text.Replace("\n", "\r\n"); }

        private void Edited(string label)
        {
            if (!restoring)
            {
                long now = clock.ElapsedMilliseconds;
                if (lastLabel != label || now - lastAt > UndoGroupMilliseconds)
                    groups.Push(new KeyValuePair<string, string>(label, lastText[label]));
                lastLabel = label;
                lastAt = now;
            }
            lastText[label] = widgets[label].Text;
            changed();
        }

        public void Undo()
        {
            if (groups.Count == 0) return;
            KeyValuePair<string, string> group = groups.Pop();
            lastLabel = null;
            restoring = true;
            try { widgets[group.Key].Text = group.Value; }
            finally { restoring = false; }
            changed();
        }
    }
}
