/**
 * Widget design-token mirror (issue #48, spec contract C7).
 *
 * The admin console's design system lives in `frontend-nextjs/src/index.css`
 * and is the single source of truth for colour, radius, spacing, elevation and
 * type. The widget is a separate npm package embedded on someone else's site,
 * so it cannot read that stylesheet at runtime — it mirrors the subset it
 * actually paints with, here, and `theme.test.ts` fails the build the moment a
 * mirrored value stops matching the console.
 *
 * Rules for this file:
 *   - It is the ONLY place the widget may hold a colour / radius / shadow /
 *     type value. `BasjooWidget.tsx` references `theme.*` and nothing else.
 *   - Colour values are copied verbatim from the stylesheet as `hsl(...)`
 *     strings (never converted to hex) so the parity test can compare strings.
 *   - Spacing is the one deliberate exception: the console declares
 *     `--space-*` in `rem`, and `rem` inside the host page would resolve
 *     against the host's `html { font-size }` instead of ours. The mirror
 *     therefore ships the resolved px value (the 4px grid is identical) and
 *     the parity test compares resolved pixels, not the raw unit.
 *   - `elevationN` is the console's `--elevation-N` with its `var()`
 *     indirections expanded: the host page does not define `--color-shadow`,
 *     so a widget rule that shipped `var(--color-shadow)` would paint nothing.
 *
 * No React, no DOM: this module is pure data so the parity test and the
 * settings preview can both consume it.
 */

/** The resolved palette / geometry / type stack for one theme. */
export interface WidgetTheme {
  /* Surfaces — the console's three-step ramp */
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;

  /* Text roles */
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;

  /* Lines */
  border: string;
  borderFocus: string;

  /* Brand */
  accent: string;
  /** The ink that sits ON an accent fill (console `.btn-primary`). */
  accentContrast: string;

  /* States */
  error: string;
  errorBg: string;
  success: string;
  successBg: string;

  /* Radii — 6 / 10 / 14 / full */
  radiusSm: string;
  radiusMd: string;
  radiusLg: string;
  radiusFull: string;

  /* Spacing — the 4px grid, resolved to px (see the header note) */
  space1: string;
  space2: string;
  space3: string;
  space4: string;
  space5: string;
  space6: string;

  /* Shadows */
  shadow1: string;
  shadow2: string;
  shadow3: string;

  /* Type */
  fontDisplay: string;
  fontText: string;

  /* Elevation — solid ring + warm shadow, `var()` expanded */
  elevation1: string;
  elevation2: string;
  elevation3: string;

  /* Leading */
  leadingTight: string;
  leadingSnug: string;
  leadingNormal: string;
}

/**
 * The console accent — `--color-accent-primary` of the dark theme,
 * `hsl(48, 96%, 49%)`, the logo's yellow.
 *
 * This is the single source for the widget's runtime fallback colour: when
 * `agent.widget_color` is null/empty the widget paints this, and it is the same
 * literal as `backend/constants.py: DEFAULT_WIDGET_COLOR` (spec contract C1).
 */
export const ACCENT = '#F9CA02';

/** Alias of {@link ACCENT}, so the name used by the spec exists. */
export const DEFAULT_ACCENT = ACCENT;

/* --------------------------------------------------------------------------
 * Geometry, spacing, type — theme independent (console `:root` block).
 * ------------------------------------------------------------------------ */

const RADIUS_SM = '6px';
const RADIUS_MD = '10px';
const RADIUS_LG = '14px';
const RADIUS_FULL = '9999px';

const SPACE_1 = '4px';
const SPACE_2 = '8px';
const SPACE_3 = '12px';
const SPACE_4 = '16px';
const SPACE_5 = '20px';
const SPACE_6 = '24px';

const LEADING_TIGHT = '1.25';
const LEADING_SNUG = '1.4';
const LEADING_NORMAL = '1.5';

const FONT_DISPLAY =
  "'Outfit', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif";
const FONT_TEXT =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif";

/* --------------------------------------------------------------------------
 * Dark — `:root, :root[data-theme='dark']`
 * ------------------------------------------------------------------------ */

const DARK: WidgetTheme = {
  surface: 'hsl(30, 7%, 9.5%)',
  surfaceRaised: 'hsl(30, 8%, 12.5%)',
  surfaceSunken: 'hsl(30, 6%, 13%)',

  textPrimary: 'hsl(40, 20%, 96%)',
  textSecondary: 'hsl(40, 10%, 76%)',
  textMuted: 'hsl(40, 8%, 63%)',
  // Warm near-black: the ink that sits ON the yellow fill (`.btn-primary`).
  textInverse: 'hsl(40, 30%, 8%)',

  border: 'hsl(35, 12%, 46%)',
  borderFocus: 'hsl(48, 96%, 49%)',

  accent: 'hsl(48, 96%, 49%)',
  accentContrast: 'hsl(40, 30%, 8%)',

  error: 'hsl(352, 80%, 68%)',
  errorBg: 'hsl(352, 22%, 15%)',
  success: 'hsl(150, 55%, 52%)',
  successBg: 'hsl(150, 20%, 13%)',

  radiusSm: RADIUS_SM,
  radiusMd: RADIUS_MD,
  radiusLg: RADIUS_LG,
  radiusFull: RADIUS_FULL,

  space1: SPACE_1,
  space2: SPACE_2,
  space3: SPACE_3,
  space4: SPACE_4,
  space5: SPACE_5,
  space6: SPACE_6,

  shadow1: '0 1px 2px hsl(30, 40%, 2%, 0.28)',
  shadow2:
    '0 2px 6px hsl(30, 40%, 2%, 0.32), 0 8px 20px -12px hsl(30, 40%, 2%, 0.4)',
  shadow3:
    '0 12px 32px -16px hsl(30, 40%, 2%, 0.55), 0 2px 8px hsl(30, 40%, 2%, 0.3)',

  fontDisplay: FONT_DISPLAY,
  fontText: FONT_TEXT,

  elevation1: '0 1px 2px hsl(30, 40%, 2%, 0.35), 0 0 0 1px hsl(35, 12%, 46%)',
  elevation2: '0 2px 4px hsl(30, 40%, 2%, 0.5), 0 0 0 1px hsl(35, 12%, 46%)',
  elevation3: '0 12px 32px hsl(30, 40%, 2%, 0.5), 0 0 0 1px hsl(35, 12%, 46%)',

  leadingTight: LEADING_TIGHT,
  leadingSnug: LEADING_SNUG,
  leadingNormal: LEADING_NORMAL,
};

/* --------------------------------------------------------------------------
 * Light — `:root[data-theme='light']`
 * ------------------------------------------------------------------------ */

const LIGHT: WidgetTheme = {
  surface: 'hsl(40, 30%, 97.5%)',
  surfaceRaised: 'hsl(40, 25%, 100%)',
  surfaceSunken: 'hsl(40, 15%, 90%)',

  textPrimary: 'hsl(30, 25%, 11%)',
  textSecondary: 'hsl(30, 14%, 30%)',
  textMuted: 'hsl(30, 10%, 40%)',
  textInverse: 'hsl(0, 0%, 100%)',

  border: 'hsl(35, 12%, 46%)',
  borderFocus: 'hsl(38, 92%, 26%)',

  // The console deepens the accent to 26% on light so the yellow still clears
  // 4.5:1 as an ink; as a fill it carries white ink.
  accent: 'hsl(38, 92%, 26%)',
  accentContrast: 'hsl(0, 0%, 100%)',

  error: 'hsl(348, 78%, 38%)',
  errorBg: 'hsl(348, 80%, 95%)',
  success: 'hsl(154, 85%, 24%)',
  successBg: 'hsl(152, 60%, 94%)',

  radiusSm: RADIUS_SM,
  radiusMd: RADIUS_MD,
  radiusLg: RADIUS_LG,
  radiusFull: RADIUS_FULL,

  space1: SPACE_1,
  space2: SPACE_2,
  space3: SPACE_3,
  space4: SPACE_4,
  space5: SPACE_5,
  space6: SPACE_6,

  shadow1: '0 1px 2px hsl(30, 30%, 20%, 0.12)',
  shadow2:
    '0 2px 6px hsl(30, 30%, 20%, 0.14), 0 8px 20px -12px hsl(30, 30%, 20%, 0.18)',
  shadow3:
    '0 12px 32px -16px hsl(30, 30%, 20%, 0.24), 0 2px 8px hsl(30, 30%, 20%, 0.12)',

  fontDisplay: FONT_DISPLAY,
  fontText: FONT_TEXT,

  elevation1: '0 1px 2px hsl(30, 30%, 20%, 0.12), 0 0 0 1px hsl(35, 12%, 46%)',
  elevation2: '0 2px 4px hsl(30, 30%, 20%, 0.18), 0 0 0 1px hsl(35, 12%, 46%)',
  elevation3: '0 12px 32px hsl(30, 30%, 20%, 0.18), 0 0 0 1px hsl(35, 12%, 46%)',

  leadingTight: LEADING_TIGHT,
  leadingSnug: LEADING_SNUG,
  leadingNormal: LEADING_NORMAL,
};

/** Both resolved palettes. */
export const THEMES: { light: WidgetTheme; dark: WidgetTheme } = {
  light: LIGHT,
  dark: DARK,
};

/** The palette for one theme. */
export function resolveTheme(prefersDark: boolean): WidgetTheme {
  return prefersDark ? THEMES.dark : THEMES.light;
}
