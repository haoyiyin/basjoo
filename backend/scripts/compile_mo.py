#!/usr/bin/env python3
"""Compile every i18n/locales/*/LC_MESSAGES/messages.po into a tracked .mo file.

There is no ``msgfmt`` on the build hosts or in the runtime image and the .mo
files are committed, so this stdlib-only compiler keeps them in sync:

    python3 scripts/compile_mo.py

Format written (GNU gettext .mo, little-endian):
magic 0x950412de, revision, message count, offset of the msgid table, offset of
the msgstr table, hash-table size (0 = none), hash-table offset, then the two
sorted string tables and the NUL-terminated string pool they point into.
"""

import re
import struct
import sys
from pathlib import Path

LOCALES_DIR = Path(__file__).resolve().parents[1] / "i18n" / "locales"

_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", '"': '"', "\\": "\\"}


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        value = value[1:-1]
    # Ceiling: only the C-ish escapes gettext actually emits. Escapes beyond
    # this set are passed through verbatim rather than decoded to codepoints.
    return re.sub(r"\\(.)", lambda m: _ESCAPES.get(m.group(1), m.group(1)), value)


def parse_po(text: str) -> dict[str, str]:
    """Parse msgid/msgstr blocks (multi-line strings joined; plurals unsupported)."""
    messages: dict[str, str] = {}
    msgid: list[str] | None = None
    msgstr: list[str] | None = None
    target: list[str] | None = None

    def flush() -> None:
        if msgid is not None and msgstr is not None:
            messages["".join(msgid)] = "".join(msgstr)

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            flush()
            msgid = msgstr = target = None
            continue
        if line.startswith("#"):
            continue
        if line.startswith("msgid "):
            flush()
            msgid, msgstr, target = [_unquote(line[6:])], None, None
            target = msgid
        elif line.startswith("msgstr "):
            msgstr, target = [_unquote(line[7:])], None
            target = msgstr
        elif line.startswith('"') and target is not None:
            target.append(_unquote(line))
    flush()
    return messages


def compile_mo(messages: dict[str, str]) -> bytes:
    """Return the .mo byte string for a msgid -> msgstr mapping."""
    messages = dict(messages)
    messages.setdefault("", "Content-Type: text/plain; charset=UTF-8\n")

    items = sorted(
        (msgid.encode("utf-8"), msgstr.encode("utf-8"))
        for msgid, msgstr in messages.items()
    )
    count = len(items)
    strings_at = 28 + 16 * count
    pool = bytearray()
    id_table = bytearray()
    str_table = bytearray()
    for msgid, msgstr in items:
        id_table += struct.pack("<II", len(msgid), strings_at + len(pool))
        pool += msgid + b"\x00"
        str_table += struct.pack("<II", len(msgstr), strings_at + len(pool))
        pool += msgstr + b"\x00"

    header = struct.pack(
        "<7I", 0x950412DE, 0, count, 28, 28 + 8 * count, 0, strings_at
    )
    return bytes(header + id_table + str_table + pool)


def main() -> int:
    po_files = sorted(LOCALES_DIR.glob("*/LC_MESSAGES/messages.po"))
    if not po_files:
        print(f"no .po catalogs under {LOCALES_DIR}", file=sys.stderr)
        return 1
    for po_path in po_files:
        messages = parse_po(po_path.read_text(encoding="utf-8"))
        mo_path = po_path.with_suffix(".mo")
        mo_path.write_bytes(compile_mo(messages))
        print(
            f"{po_path.parent.parent.name}: {len(messages)} messages -> "
            f"{mo_path.name} ({mo_path.stat().st_size} bytes)"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
