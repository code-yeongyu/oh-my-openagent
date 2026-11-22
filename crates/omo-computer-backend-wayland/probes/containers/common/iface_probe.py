"""SP-W portal-interface presence check. Pure: the D-Bus calls are passed in, so it is testable without a bus.

probe_interface(name, introspect, get_version) answers one of three ways:
  {"version": v, "interfaces": [...]}  the frontend lists org.freedesktop.portal.<name> and its version was read
  {"absent": True, "interfaces": [...]} the frontend's interface list came back and does not contain the name
  {"error": "<text>"}                   a call failed, or the introspection did not parse: nothing was measured
"absent" is only ever the second case. A failed call is never evidence that an interface is missing."""
import xml.etree.ElementTree as ET

PREFIX = "org.freedesktop.portal."


def parse_interfaces(xml_text):
    """The interface names declared on the introspected node itself (child <node> elements are not interfaces)."""
    root = ET.fromstring(xml_text)
    return [el.get("name") for el in root.findall("interface") if el.get("name")]


def error_text(exc):
    return getattr(exc, "message", None) or str(exc) or type(exc).__name__


def probe_interface(name, introspect, get_version):
    full = PREFIX + name
    try:
        interfaces = parse_interfaces(introspect())
    except Exception as exc:  # GLib.Error from the call, ParseError from the reply: both mean "not measured"
        return {"error": error_text(exc)}
    if full not in interfaces:
        return {"absent": True, "interfaces": interfaces}
    try:
        return {"version": get_version(full), "interfaces": interfaces}
    except Exception as exc:
        return {"error": error_text(exc)}
