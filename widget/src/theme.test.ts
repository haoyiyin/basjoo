/**
 * Widget token parity gate (issue #48, spec contract C7).
 *
 * `widget/src/theme.ts` is a *mirror* of `frontend-nextjs/src/index.css`. A
 * mirror drifts, so this file parses the console stylesheet as text and fails
 * the moment a mirrored value stops matching it. The console already has the
 * same harness (`frontend-nextjs/tests/unit/designTokens.test.ts`); the parsing
 * helpers below are copied from it on purpose — the widget is a separate npm
 * package and must not import across the package boundary.
 *
 * Assertion groups
 *   1. every mirrored colour / radius / shadow / elevation / type / leading
 *      value equals the console token, in BOTH themes, and the failure message
 *      names the role, the token and both values
 *   2. `ACCENT` is the console accent, and its hsl numbers really are the
 *      logo yellow (#F9CA02)
 *   3. the WCAG 2.1 contrast floors the console asserts, computed from the
 *      widget's own values (so the widget cannot ship a legible console and an
 *      illegible panel)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ACCENT, DEFAULT_ACCENT, THEMES, resolveTheme } from './theme';
import type { WidgetTheme } from './theme';

/* ------------------------------------------------------------------ parsing */

interface CssRule {
  selectors: string[];
  declarations: string;
  /** Enclosing at-statements, outermost first (`@media (max-width: 768px)`). */
  atMedia: string[];
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * Hand-written CSS walker: returns every rule together with the at-statements
 * wrapping it. `@keyframes` bodies are skipped (their "selectors" are
 * percentages) and top-level statements (`@import`) never leak into the next
 * selector because `;` resets the buffer.
 */
function parseRules(src: string, atMedia: string[] = []): CssRule[] {
  const rules: CssRule[] = [];
  let buffer = '';
  let index = 0;

  while (index < src.length) {
    const char = src[index];

    if (char === '{') {
      const selectorText = buffer.trim();
      buffer = '';
      let depth = 1;
      let cursor = index + 1;
      while (cursor < src.length && depth > 0) {
        if (src[cursor] === '{') depth += 1;
        else if (src[cursor] === '}') depth -= 1;
        cursor += 1;
      }
      const body = src.slice(index + 1, cursor - 1);
      index = cursor;

      if (selectorText.startsWith('@media') || selectorText.startsWith('@supports')) {
        rules.push(
          ...parseRules(body, [...atMedia, selectorText.replace(/\s+/g, ' ')]),
        );
        continue;
      }
      if (selectorText.startsWith('@')) continue;

      rules.push({
        selectors: selectorText
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part.length > 0),
        declarations: body,
        atMedia,
      });
      continue;
    }

    if (char === ';' || char === '}') {
      buffer = '';
      index += 1;
      continue;
    }

    buffer += char;
    index += 1;
  }

  return rules;
}

/** `property -> value` for one declaration block (later declarations win). */
function declarationMap(declarations: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /(--[\w-]+|[a-z][a-z-]*)\s*:\s*([^;]+)/gi;
  let match = re.exec(declarations);
  while (match !== null) {
    out.set(match[1].toLowerCase().trim(), match[2].trim());
    match = re.exec(declarations);
  }
  return out;
}

/** The console stylesheet, one directory up from `widget/`. */
const CSS_PATH = resolve(__dirname, '../../frontend-nextjs/src/index.css');
const CSS = stripComments(readFileSync(CSS_PATH, 'utf8'));
const RULES = parseRules(CSS).filter((rule) => rule.atMedia.length === 0);

function findRule(predicate: (selector: string) => boolean, label: string): CssRule {
  const found = RULES.find((rule) => rule.selectors.some(predicate));
  if (!found) throw new Error(`index.css must declare a top-level block: ${label}`);
  return found;
}

type ThemeName = 'light' | 'dark';

const BASE_TOKENS = declarationMap(
  findRule((selector) => selector === ':root', ':root { ... }').declarations,
);

const DARK_TOKENS = new Map([
  ...BASE_TOKENS,
  ...declarationMap(
    findRule(
      (selector) => selector === ":root[data-theme='dark']",
      ":root, :root[data-theme='dark'] { ... }",
    ).declarations,
  ),
]);

const LIGHT_TOKENS = new Map([
  ...BASE_TOKENS,
  ...declarationMap(
    findRule(
      (selector) => selector === ":root[data-theme='light']",
      ":root[data-theme='light'] { ... }",
    ).declarations,
  ),
]);

const CSS_TOKENS: Record<ThemeName, Map<string, string>> = {
  light: LIGHT_TOKENS,
  dark: DARK_TOKENS,
};

const THEME_NAMES: ThemeName[] = ['light', 'dark'];

function cssToken(theme: ThemeName, token: string): string {
  const raw = CSS_TOKENS[theme].get(token) ?? BASE_TOKENS.get(token);
  if (raw === undefined) throw new Error(`${token} is not defined (${theme})`);
  return raw.trim();
}

/** Collapses a (possibly multi-line) declaration value to one spaced line. */
function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Resolves a `var(--x)` indirection chain to its raw value. */
function resolveToken(theme: ThemeName, token: string, depth = 0): string {
  const value = cssToken(theme, token);
  const ref = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(value);
  if (!ref) return value;
  if (depth > 8) throw new Error(`var() cycle at ${token} (${theme})`);
  return resolveToken(theme, ref[1], depth + 1);
}

/** Expands every `var()` in a declaration value against the theme tokens. */
function expandVars(theme: ThemeName, value: string): string {
  let out = value;
  for (let step = 0; step < 8; step += 1) {
    const next = out.replace(
      /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g,
      (_match: string, name: string, fallback?: string): string => {
        const raw = CSS_TOKENS[theme].get(name) ?? BASE_TOKENS.get(name);
        if (raw !== undefined) return raw.trim();
        return fallback !== undefined ? fallback.trim() : '';
      },
    );
    if (next === out) break;
    out = next;
  }
  return normalize(out);
}

/** `rem`/`px` declaration -> pixels (the console root is 16px). */
function px(value: string): number {
  const raw = normalize(value);
  if (/rem$/.test(raw)) return Number.parseFloat(raw) * 16;
  if (/em$/.test(raw)) return Number.parseFloat(raw) * 16;
  return Number.parseFloat(raw);
}

/* -------------------------------------------------------------- colour math */

interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return { r: rgb[0] + m, g: rgb[1] + m, b: rgb[2] + m, a: 1 };
}

/** Supports #rgb, #rrggbb and hsl()/hsla() — the shapes the widget accepts. */
function parseColor(raw: string): Rgb | null {
  const value = raw.trim();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits = hex[1];
    const bytes =
      digits.length === 3
        ? digits.split('').map((d) => parseInt(d + d, 16))
        : [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
    return { r: bytes[0], g: bytes[1], b: bytes[2], a: 1 };
  }

  const fn = /^hsla?\(([^)]*)\)$/i.exec(value);
  if (!fn) return null;
  const args = fn[1]
    .split(/[\s,/]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const alpha = args.length > 3 ? Number.parseFloat(args[3]) : 1;
  const rgb = hslToRgb(
    Number.parseFloat(args[0]),
    Number.parseFloat(args[1]),
    Number.parseFloat(args[2]),
  );
  // Both branches return 0-255 channels so the two forms compare directly.
  return { r: rgb.r * 255, g: rgb.g * 255, b: rgb.b * 255, a: alpha };
}

function colourOf(theme: ThemeName, token: string): Rgb {
  const raw = resolveToken(theme, token);
  const parsed = parseColor(raw);
  if (!parsed) throw new Error(`${token} is not a colour (${theme}): "${raw}"`);
  return parsed;
}

function gamma(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(color: Rgb): number {
  return (
    0.2126 * gamma(color.r / 255) +
    0.7152 * gamma(color.g / 255) +
    0.0722 * gamma(color.b / 255)
  );
}

/** WCAG 2.1 contrast ratio for two opaque colours. */
function contrastRatio(front: Rgb, back: Rgb): number {
  const l1 = luminance(front);
  const l2 = luminance(back);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/* ------------------------------------------------------------ expectations */

/** role on `WidgetTheme` -> the console custom property it mirrors. */
const COLOUR_TOKENS: Array<[keyof WidgetTheme, string]> = [
  ['surface', '--color-bg-secondary'],
  ['surfaceRaised', '--color-bg-elevated'],
  ['surfaceSunken', '--color-bg-tertiary'],
  ['textPrimary', '--color-text-primary'],
  ['textSecondary', '--color-text-secondary'],
  ['textMuted', '--color-text-muted'],
  ['textInverse', '--color-text-inverse'],
  ['border', '--color-border'],
  ['borderFocus', '--color-border-focus'],
  ['accent', '--color-accent-primary'],
  ['error', '--color-error'],
  ['errorBg', '--color-error-bg'],
  ['success', '--color-success'],
  ['successBg', '--color-success-bg'],
];

/** Verbatim-copy tokens: the widget ships the same string the console does. */
const VERBATIM_TOKENS: Array<[keyof WidgetTheme, string]> = [
  ['radiusSm', '--radius-sm'],
  ['radiusMd', '--radius-md'],
  ['radiusLg', '--radius-lg'],
  ['radiusFull', '--radius-full'],
  ['leadingTight', '--leading-tight'],
  ['leadingSnug', '--leading-snug'],
  ['leadingNormal', '--leading-normal'],
];

/** Spacing: the console declares `rem`, the mirror ships the px equivalent. */
const SPACE_TOKENS: Array<[keyof WidgetTheme, string]> = [
  ['space1', '--space-1'],
  ['space2', '--space-2'],
  ['space3', '--space-3'],
  ['space4', '--space-4'],
  ['space5', '--space-5'],
  ['space6', '--space-6'],
];

/** Shadows / elevation are compared with their `var()` chains expanded. */
const SHADOW_TOKENS: Array<[keyof WidgetTheme, string]> = [
  ['shadow1', '--shadow-sm'],
  ['shadow2', '--shadow-md'],
  ['shadow3', '--shadow-lg'],
  ['elevation1', '--elevation-1'],
  ['elevation2', '--elevation-2'],
  ['elevation3', '--elevation-3'],
];

/** The type stack is theme independent, declared once in `:root`. */
const FONT_TOKENS: Array<[keyof WidgetTheme, string]> = [
  ['fontDisplay', '--font-display'],
  ['fontText', '--font-text'],
];

describe('widget theme: the mirror matches the console stylesheet', () => {
  it('parses both theme blocks out of index.css', () => {
    for (const theme of THEME_NAMES) {
      // A parse that silently produced an empty map would make every parity
      // assertion below vacuous.
      expect(CSS_TOKENS[theme].size, `${theme} tokens`).toBeGreaterThan(40);
      expect(cssToken(theme, '--color-accent-primary')).toMatch(/^hsl\(/);
    }
  });

  it('copies every colour role from the console token of the same name', () => {
    for (const theme of THEME_NAMES) {
      for (const [role, token] of COLOUR_TOKENS) {
        const mirrored = THEMES[theme][role];
        const expected = normalize(cssToken(theme, token));
        expect(
          mirrored,
          `theme.${theme}.${String(role)} must equal ${token} from index.css ` +
            `(widget: ${mirrored}, console: ${expected})`,
        ).toBe(expected);
      }
    }
  });

  it('copies radii and leading verbatim', () => {
    for (const theme of THEME_NAMES) {
      for (const [role, token] of VERBATIM_TOKENS) {
        const mirrored = THEMES[theme][role];
        const expected = normalize(cssToken(theme, token));
        expect(
          mirrored,
          `theme.${theme}.${String(role)} must equal ${token} from index.css ` +
            `(widget: ${mirrored}, console: ${expected})`,
        ).toBe(expected);
      }
    }
  });

  it('keeps spacing on the console 4px grid', () => {
    for (const theme of THEME_NAMES) {
      for (const [role, token] of SPACE_TOKENS) {
        const mirrored = px(THEMES[theme][role]);
        const expected = px(cssToken(theme, token));
        expect(
          mirrored,
          `theme.${theme}.${String(role)} must equal ${token} from index.css ` +
            `(widget: ${mirrored}px, console: ${expected}px)`,
        ).toBe(expected);
      }
    }
  });

  it('copies shadows and elevation with the var() chains resolved', () => {
    for (const theme of THEME_NAMES) {
      for (const [role, token] of SHADOW_TOKENS) {
        const mirrored = normalize(THEMES[theme][role]);
        const expected = expandVars(theme, cssToken(theme, token));
        expect(
          mirrored,
          `theme.${theme}.${String(role)} must equal ${token} from index.css ` +
            `with var() expanded (widget: ${mirrored}, console: ${expected})`,
        ).toBe(expected);
      }
    }
  });

  it('copies the display and text type stacks', () => {
    for (const theme of THEME_NAMES) {
      for (const [role, token] of FONT_TOKENS) {
        const mirrored = normalize(THEMES[theme][role]);
        const expected = normalize(cssToken(theme, token));
        expect(
          mirrored,
          `theme.${theme}.${String(role)} must equal ${token} from index.css ` +
            `(widget: ${mirrored}, console: ${expected})`,
        ).toBe(expected);
      }
    }
    // The display face is what makes the widget read as the console, not a
    // generic system stack.
    expect(THEMES.light.fontDisplay).toContain('Outfit');
    expect(THEMES.dark.fontDisplay).toContain('Outfit');
  });

  it('paints accent fills with the ink the console pairs with them', () => {
    // `.btn-primary` is the reference: `color: var(--color-text-inverse)` on
    // `background: var(--color-accent-primary)`.
    const buttonPrimary = RULES.find((rule) =>
      rule.selectors.includes('.btn-primary'),
    );
    expect(buttonPrimary, '.btn-primary must exist').not.toBe(undefined);
    const declarations = declarationMap(buttonPrimary!.declarations);
    expect(normalize(String(declarations.get('color')))).toBe(
      'var(--color-text-inverse)',
    );

    for (const theme of THEME_NAMES) {
      expect(
        THEMES[theme].accentContrast,
        `theme.${theme}.accentContrast must be the console's on-accent ink`,
      ).toBe(normalize(cssToken(theme, '--color-text-inverse')));
    }
  });

  it('resolves the palette from the prefers-dark flag', () => {
    expect(resolveTheme(true)).toBe(THEMES.dark);
    expect(resolveTheme(false)).toBe(THEMES.light);
  });
});

describe('widget theme: one accent, and it is the logo yellow', () => {
  it('ACCENT is the console accent and DEFAULT_ACCENT is the same value', () => {
    expect(ACCENT).toBe('#F9CA02');
    expect(DEFAULT_ACCENT).toBe(ACCENT);

    // Colour equality, not string equality: the console writes the accent as
    // an hsl() triple and the shipped constant as the logo's hex.
    const accent = parseColor(ACCENT);
    const consoleAccent = colourOf('dark', '--color-accent-primary');
    expect(accent, 'ACCENT must parse as a colour').not.toBe(null);

    // The stylesheet's own comment pairs #F9CA02 with hsl(48 96% 49%), i.e.
    // an integer-rounded hsl that lands within ~5/255 per channel of the hex.
    // 1/255 would reject the console's own documented value, so the tolerance
    // is the rounding error of that pair, not a loosened check.
    const TOLERANCE = 6 / 255;
    for (const channel of ['r', 'g', 'b'] as const) {
      expect(
        Math.abs(accent![channel] - consoleAccent[channel]) / 255,
        `ACCENT.${channel} must match --color-accent-primary within ${TOLERANCE}`,
      ).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  it('hsl(48, 96%, 49%) round-trips to #F9CA02 in hue, saturation and lightness', () => {
    const fromHsl = parseColor('hsl(48, 96%, 49%)');
    const fromHex = parseColor('#F9CA02');
    expect(fromHsl).not.toBe(null);
    expect(fromHex).not.toBe(null);

    const hslToHsl = (color: Rgb): { h: number; s: number; l: number } => {
      const r = color.r / 255;
      const g = color.g / 255;
      const b = color.b / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      const d = max - min;
      if (d === 0) return { h: 0, s: 0, l: l * 100 };
      const s = d / (1 - Math.abs(2 * l - 1));
      let h: number;
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
      return { h: (h + 360) % 360, s: s * 100, l: l * 100 };
    };

    const parsed = hslToHsl(fromHex!);
    // #F9CA02 is hsl(48.6, 98.4%, 49.2%) — the console's rounded 48/96/49.
    expect(Math.abs(parsed.h - 48), 'hue').toBeLessThanOrEqual(1);
    expect(Math.abs(parsed.s - 96), 'saturation').toBeLessThanOrEqual(3);
    expect(Math.abs(parsed.l - 49), 'lightness').toBeLessThanOrEqual(1);

    // ...and the same numbers come back out of the hsl() string.
    const recomputed = hslToHsl(fromHsl!);
    expect(Math.abs(recomputed.h - 48)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(recomputed.s - 96)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(recomputed.l - 49)).toBeLessThanOrEqual(0.5);
  });
});

describe('widget theme: contrast floors in both themes', () => {
  /** Contrast of two roles of the widget's own palette. */
  function ratio(theme: ThemeName, front: keyof WidgetTheme, back: keyof WidgetTheme): number {
    const frontColor = parseColor(THEMES[theme][front]);
    const backColor = parseColor(THEMES[theme][back]);
    if (!frontColor || !backColor) {
      throw new Error(`${String(front)} / ${String(back)} is not a colour (${theme})`);
    }
    return contrastRatio(frontColor, backColor);
  }

  const FLOORS: Array<[keyof WidgetTheme, keyof WidgetTheme, number]> = [
    ['textPrimary', 'surface', 12],
    ['textSecondary', 'surface', 7],
    ['textMuted', 'surface', 4.5],
    ['border', 'surface', 3],
    ['textPrimary', 'surfaceRaised', 12],
    ['textInverse', 'accent', 4.5],
  ];

  it('holds the console text/border floors on the widget surfaces', () => {
    for (const theme of THEME_NAMES) {
      for (const [front, back, floor] of FLOORS) {
        expect(
          ratio(theme, front, back),
          `${String(front)} on ${String(back)} (${theme}) must be >= ${floor}:1`,
        ).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it('keeps the state colours legible on their own tints', () => {
    for (const theme of THEME_NAMES) {
      expect(
        ratio(theme, 'error', 'errorBg'),
        `error text on errorBg (${theme})`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        ratio(theme, 'success', 'successBg'),
        `success text on successBg (${theme})`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
