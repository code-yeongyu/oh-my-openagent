#!/usr/bin/env python3
"""Tests for iface_probe: the portal-interface presence check of SP-W. Stdlib only, no D-Bus, no container.
Run: python3 -m unittest crates/omo-computer-backend-wayland/probes/containers/common/test_iface_probe.py"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from iface_probe import parse_interfaces, probe_interface  # noqa: E402

# The shape the portal frontend returns from Introspect on /org/freedesktop/portal/desktop (trimmed).
FRONTEND_XML = """<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
<node>
  <interface name="org.freedesktop.DBus.Properties">
    <method name="Get"><arg type="s" name="interface_name" direction="in"/></method>
  </interface>
  <interface name="org.freedesktop.DBus.Introspectable"><method name="Introspect"/></interface>
  <interface name="org.freedesktop.portal.ScreenCast">
    <property type="u" name="version" access="read"/>
  </interface>
  <interface name="org.freedesktop.portal.RemoteDesktop">
    <property type="u" name="version" access="read"/>
  </interface>
  <node name="request"/>
</node>
"""


class FakeGLibError(Exception):
    """Stands in for GLib.Error: the probe must report its text, whatever the class."""


def never(_name=None):
    raise AssertionError("must not be called")


class ParseInterfaces(unittest.TestCase):
    def test_lists_every_interface_element_of_the_node(self):
        self.assertEqual(
            parse_interfaces(FRONTEND_XML),
            [
                "org.freedesktop.DBus.Properties",
                "org.freedesktop.DBus.Introspectable",
                "org.freedesktop.portal.ScreenCast",
                "org.freedesktop.portal.RemoteDesktop",
            ],
        )

    def test_child_nodes_are_not_interfaces(self):
        self.assertNotIn("request", parse_interfaces(FRONTEND_XML))

    def test_malformed_xml_raises(self):
        with self.assertRaises(Exception):
            parse_interfaces("<node><interface name='x'>")


class ProbeInterface(unittest.TestCase):
    def test_present_returns_the_version(self):
        got = probe_interface("ScreenCast", lambda: FRONTEND_XML, lambda iface: 5 if iface == "org.freedesktop.portal.ScreenCast" else never())
        self.assertEqual(got, {"version": 5, "interfaces": parse_interfaces(FRONTEND_XML)})

    def test_absent_only_when_the_list_came_back_without_the_name(self):
        got = probe_interface("GlobalShortcuts", lambda: FRONTEND_XML, never)
        self.assertEqual(got, {"absent": True, "interfaces": parse_interfaces(FRONTEND_XML)})

    def test_introspect_error_is_an_error_never_absent(self):
        def boom():
            raise FakeGLibError("GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown: no portal")

        got = probe_interface("GlobalShortcuts", boom, never)
        self.assertEqual(got, {"error": "GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown: no portal"})
        self.assertNotIn("absent", got)

    def test_version_read_error_on_a_listed_interface_is_an_error(self):
        def boom(_iface):
            raise FakeGLibError("GDBus.Error:org.freedesktop.DBus.Error.NoReply: timeout")

        got = probe_interface("RemoteDesktop", lambda: FRONTEND_XML, boom)
        self.assertEqual(got, {"error": "GDBus.Error:org.freedesktop.DBus.Error.NoReply: timeout"})

    def test_unparseable_introspection_is_an_error(self):
        got = probe_interface("Clipboard", lambda: "<node><interface", never)
        self.assertIn("error", got)
        self.assertNotIn("absent", got)


if __name__ == "__main__":
    unittest.main()
