#!/usr/bin/env python3
"""SP-W Qt6 fixture: one window with one line edit, application name spw-qt6-fixture. No accessibility setup."""
import sys
from PyQt6.QtWidgets import QApplication, QLineEdit

app = QApplication(sys.argv)
app.setApplicationName("spw-qt6-fixture")
w = QLineEdit()
w.setWindowTitle("spw-qt6-fixture")
w.show()
sys.exit(app.exec())
