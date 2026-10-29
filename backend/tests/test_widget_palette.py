"""One default widget colour, asserted across the four surfaces that hold it.

Issue #48 / spec contract C1: the shipped default widget colour used to be three
different blues — the model default ``#06B6D4``, the SPA constant ``#00aaff``
and the widget's runtime fallback ``#3B82F6`` — none of which was the product
accent. There is now exactly one value, the console accent ``#F9CA02``
(``hsl(48 96% 49%)``), and it is declared in each surface because they are
different languages / packages:

    backend/constants.py                      DEFAULT_WIDGET_COLOR
    backend/models.py                         Agent.widget_color default (the constant)
    widget/src/theme.ts                       ACCENT / DEFAULT_ACCENT
    frontend-nextjs/src/views/AgentSettings.tsx   DEFAULT_WIDGET_COLOR

These tests parse those files as *text* — no imports of the SPA, the widget or
the app itself — so a drift is caught even when the surface is not on the
import path of anything. The same file also asserts that the widget source
holds no colour literal at all: every colour it paints comes from the mirror of
``frontend-nextjs/src/index.css`` (spec contract C7).
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

CONSTANTS_PY = REPO_ROOT / "backend" / "constants.py"
MODELS_PY = REPO_ROOT / "backend" / "models.py"
THEME_TS = REPO_ROOT / "widget" / "src" / "theme.ts"
# The SPA cannot import above its own package root (the dev container mounts
# only `frontend-nextjs`, and the production image copies only `src public
# index.html *.json *.ts`), so `scripts/sync-widget-theme.mjs` copies the mirror
# in. This path is the copy; THEME_TS stays the single source of truth.
SPA_THEME_TS = REPO_ROOT / "frontend-nextjs" / "src" / "design" / "widgetTheme.ts"
AGENT_SETTINGS_TSX = (
    REPO_ROOT / "frontend-nextjs" / "src" / "views" / "AgentSettings.tsx"
)
WIDGET_TSX = REPO_ROOT / "widget" / "src" / "BasjooWidget.tsx"

# The console accent: `--color-accent-primary` of the dark theme in
# frontend-nextjs/src/index.css, `hsl(48, 96%, 49%)`, the logo's yellow.
EXPECTED_COLOUR = "#F9CA02"

# Any CSS colour literal: hex, hsl()/hsla(), rgb()/rgba().
COLOUR_LITERAL = re.compile(r"#[0-9a-fA-F]{3,8}\b|hsla?\([^)]*\)")


def _read(path: Path) -> str:
    assert path.is_file(), f"expected source file is missing: {path}"
    return path.read_text(encoding="utf-8")


# ---- the four surfaces agree ------------------------------------------------


def test_backend_constant_is_the_console_accent():
    source = _read(CONSTANTS_PY)
    match = re.search(
        r"^DEFAULT_WIDGET_COLOR\s*=\s*[\"'](#[0-9a-fA-F]{6})[\"']",
        source,
        re.MULTILINE,
    )
    assert match is not None, "constants.py must define DEFAULT_WIDGET_COLOR"
    assert match.group(1).upper() == EXPECTED_COLOUR

    # The comment has to name where the value comes from, or the next reader
    # will "fix" it to whatever blue their brand uses.
    block = source[: match.start()]
    assert "index.css" in block, "the constant must name frontend-nextjs/src/index.css"
    assert "hsl" in block.lower(), "the constant must name the hsl() form"


def test_model_default_is_the_constant_not_a_literal():
    source = _read(MODELS_PY)
    match = re.search(
        r"widget_color\s*=\s*Column\(\s*String\(\s*\d+\s*\)\s*,"
        r"[^\n]*?default\s*=\s*([A-Za-z_][\w.]*|[\"'][^\"']*[\"'])",
        source,
    )
    assert match is not None, "models.py must declare Agent.widget_color with a default"
    assert match.group(1) == "DEFAULT_WIDGET_COLOR", (
        "Agent.widget_color must default to the shared constant, not a literal "
        f"(found {match.group(1)!r})"
    )

    # ...and the constant must actually be imported (a bare name would be a
    # NameError at import time, which the model module would surface).
    assert re.search(
        r"^from constants import .*\bDEFAULT_WIDGET_COLOR\b", source, re.MULTILINE
    ), "models.py must import DEFAULT_WIDGET_COLOR from constants"

    # No retired default may survive anywhere in the model.
    for retired in ("#06B6D4", "#00aaff", "#3B82F6"):
        assert retired.lower() not in source.lower(), (
            f"{retired} is a retired default and must not remain in models.py"
        )


def test_widget_theme_accent_matches():
    source = _read(THEME_TS)
    match = re.search(
        r"^export const ACCENT\s*=\s*[\"'](#[0-9a-fA-F]{6})[\"']",
        source,
        re.MULTILINE,
    )
    assert match is not None, "theme.ts must export ACCENT"
    assert match.group(1).upper() == EXPECTED_COLOUR

    # The spec name must exist and be the same value, not a second literal.
    alias = re.search(
        r"^export const DEFAULT_ACCENT\s*=\s*(\w+|[\"'][^\"']*[\"'])",
        source,
        re.MULTILINE,
    )
    assert alias is not None, "theme.ts must export DEFAULT_ACCENT"
    assert alias.group(1) == "ACCENT", (
        "DEFAULT_ACCENT must alias ACCENT, not re-declare the value "
        f"(found {alias.group(1)!r})"
    )


def test_settings_page_default_matches():
    source = _read(AGENT_SETTINGS_TSX)
    match = re.search(
        r"^const DEFAULT_WIDGET_COLOR\s*=\s*['\"](#[0-9a-fA-F]{6})['\"]",
        source,
        re.MULTILINE,
    )
    assert match is not None, "AgentSettings.tsx must declare DEFAULT_WIDGET_COLOR"
    assert match.group(1).upper() == EXPECTED_COLOUR

    block = source[: match.start()]
    assert "backend/constants.py" in block, (
        "the SPA constant must name backend/constants.py as its source"
    )


def test_all_surfaces_agree_on_one_value():
    """The four declarations, read as text, resolve to the same colour."""

    constants = re.search(
        r"^DEFAULT_WIDGET_COLOR\s*=\s*[\"'](#[0-9a-fA-F]{6})[\"']",
        _read(CONSTANTS_PY),
        re.MULTILINE,
    )
    theme = re.search(
        r"^export const ACCENT\s*=\s*[\"'](#[0-9a-fA-F]{6})[\"']",
        _read(THEME_TS),
        re.MULTILINE,
    )
    settings = re.search(
        r"^const DEFAULT_WIDGET_COLOR\s*=\s*['\"](#[0-9a-fA-F]{6})['\"]",
        _read(AGENT_SETTINGS_TSX),
        re.MULTILINE,
    )
    found = {
        "backend/constants.py": constants and constants.group(1),
        "widget/src/theme.ts": theme and theme.group(1),
        "frontend-nextjs/src/views/AgentSettings.tsx": settings and settings.group(1),
    }
    assert all(found.values()), f"every surface must declare a colour: {found}"
    assert {value.upper() for value in found.values()} == {EXPECTED_COLOUR}, (
        f"the widget default colour must be one value everywhere: {found}"
    )


# ---- the widget source holds no colour literal ------------------------------

# The module header names the rule ("never add a colour literal here") and the
# colour helpers document the shapes they accept. Both are prose about colours,
# not colour values, so the scan excludes comment lines and then asserts the
# remaining code is literal-free.
COMMENT_LINE = re.compile(r"^\s*(?:\*|/\*|//)")


def _widget_code_lines() -> list[tuple[int, str]]:
    return [
        (number, line)
        for number, line in enumerate(_read(WIDGET_TSX).splitlines(), start=1)
        if not COMMENT_LINE.match(line)
    ]


def test_widget_source_has_no_colour_literal():
    offenders = [
        (number, match.group(0), line.strip())
        for number, line in _widget_code_lines()
        for match in [COLOUR_LITERAL.search(line)]
        if match is not None
    ]
    assert offenders == [], (
        "BasjooWidget.tsx must paint through theme.* / widget_color only; "
        f"found colour literals: {offenders}"
    )


# Two shapes in the widget are not colour literals and are excluded by scope:
#   - `transparent` / `inherit` / `currentColor` paint nothing of their own (the
#     `pre code` rule clears a background it must not repaint), so they are
#     structural keywords, not palette values;
#   - `rgba(${r}, ${g}, ${b}, ${alpha})` is the *output template* of the colour
#     helper — its channels are variables. A numeric `rgba(…)` is a literal.
NON_INK_KEYWORD = re.compile(
    r"(?<![\w-])(?:transparent|inherit|currentColor|none)(?![\w-])"
)
NAMED_INK = re.compile(
    r"(?<![\w-])(?:white|black|red|blue|green|gray|grey|silver|yellow|orange|"
    r"purple|pink|brown|navy|teal|maroon|olive|lime|aqua|fuchsia)(?![\w-])"
)
NUMERIC_RGB = re.compile(r"rgba?\(\s*\d")


def test_widget_source_holds_no_rgb_or_named_colour_either():
    """`rgb()`/`rgba()` and CSS colour keywords are literals too."""

    offenders = [
        (number, line.strip())
        for number, line in _widget_code_lines()
        if NUMERIC_RGB.search(line)
        or NAMED_INK.search(NON_INK_KEYWORD.sub("", line))
    ]
    assert offenders == [], (
        "BasjooWidget.tsx must not hard-code rgb()/named colours either; "
        f"found: {offenders}"
    )


def test_widget_uses_the_theme_mirror():
    source = _read(WIDGET_TSX)
    assert "from './theme'" in source, (
        "BasjooWidget.tsx must import the token mirror from ./theme"
    )
    assert "resolveTheme(" in source, "the widget must resolve its palette per theme"
    assert "DEFAULT_ACCENT" in source, (
        "the runtime fallback colour must be DEFAULT_ACCENT, not a literal"
    )


# ---- the mirror exists at all ----------------------------------------------


def test_theme_mirror_and_parity_gate_exist():
    """The parity gate is the point of the issue; an empty mirror is a regression."""

    theme = _read(THEME_TS)
    for role in (
        "surface",
        "surfaceRaised",
        "surfaceSunken",
        "textPrimary",
        "textSecondary",
        "textMuted",
        "textInverse",
        "border",
        "borderFocus",
        "accent",
        "accentContrast",
        "error",
        "errorBg",
        "success",
        "successBg",
        "radiusSm",
        "radiusMd",
        "radiusLg",
        "radiusFull",
        "space1",
        "space6",
        "shadow1",
        "shadow3",
        "fontDisplay",
        "fontText",
        "elevation1",
        "elevation3",
        "leadingTight",
        "leadingSnug",
        "leadingNormal",
    ):
        assert re.search(rf"^\s*{role}\s*:", theme, re.MULTILINE), (
            f"theme.ts must declare the {role} role"
        )
    assert re.search(r"^export const THEMES\b", theme, re.MULTILINE)
    assert re.search(r"^export function resolveTheme\b", theme, re.MULTILINE)

    gate = THEME_TS.with_name("theme.test.ts")
    assert gate.is_file(), "widget/src/theme.test.ts (the parity gate) must exist"
    gate_source = _read(gate)
    assert "index.css" in gate_source, "the parity gate must read the console stylesheet"

# ---- the SPA's copy is byte-identical to the mirror -------------------------

def test_spa_copy_is_byte_identical_to_the_widget_mirror():
    """The SPA gets a copy, not an import — so the copy must not drift.

    `frontend-nextjs` is built and served from a container that contains only
    the SPA package, so `widget/src/theme.ts` genuinely cannot be imported at
    runtime there. The generated copy is therefore the app's only definition;
    allowing it to diverge would quietly restore the second palette this issue
    exists to delete.
    """

    source = _read(THEME_TS)
    copy = _read(SPA_THEME_TS)

    assert copy != source, (
        "the SPA copy must carry its GENERATED header, otherwise nobody can "
        "tell which of the two files to edit"
    )
    assert copy.endswith(source), (
        "frontend-nextjs/src/design/widgetTheme.ts must end with the exact "
        "contents of widget/src/theme.ts — run `npm run sync-widget-theme` "
        "from the repo root (or `npm run build` in frontend-nextjs)"
    )

    # The header is the only permitted difference, and it must say so.
    header = copy[: len(copy) - len(source)]
    assert "GENERATED FILE" in header, "the copy's header must mark it generated"
    assert "widget/src/theme.ts" in header, "the header must name the real source"
    assert "DO NOT EDIT" in header, "the header must say the file is not editable"

def test_generator_and_its_hooks_exist():
    """A copy that is not regenerated is just a second palette again."""

    # It must live inside the SPA package: the production image copies only
    # `frontend-nextjs`, so a repo-root script would not exist at build time.
    generator = REPO_ROOT / "frontend-nextjs" / "scripts" / "sync-widget-theme.mjs"
    assert generator.is_file(), (
        "frontend-nextjs/scripts/sync-widget-theme.mjs must exist (inside the "
        "package, because the production image does not contain the repo root)"
    )
    gen_source = _read(generator)
    assert "widget/src/theme.ts" in gen_source
    assert "widgetTheme.ts" in gen_source

    package = _read(REPO_ROOT / "frontend-nextjs" / "package.json")
    assert '"predev"' in package, "dev must regenerate the copy before starting"
    assert '"prebuild"' in package, "build must regenerate the copy before bundling"
    assert package.count("sync-widget-theme.mjs") >= 2, (
        "both predev and prebuild must invoke the generator"
    )
