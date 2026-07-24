"""premiere-cli — drive Adobe Premiere Pro from the command line.

A Python CLI (``premiere-cli``, ``premiere-log``) paired with a bundled CEP
panel that exposes Premiere Pro's ExtendScript/QE APIs over a local HTTP
server (port 47823).
"""

# Kept in lockstep with PANEL_VERSION in panel/js/main.js and the version in
# pyproject.toml — `premiere-cli doctor` compares the installed panel's
# version against this one.
__version__ = "0.4.1"
