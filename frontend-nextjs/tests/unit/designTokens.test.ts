// @vitest-environment jsdom
/**
 * Spec §12 (lane DS) — the mandatory design-system self-check.
 *
 * `src/index.css` is the single source of truth for the admin design system,
 * so this file asserts the contract by parsing the stylesheet itself rather
 * than trusting it. Every contrast number is computed from the parsed token
 * values with the WCAG 2.1 relative-luminance formula, for BOTH themes.
 *
 * Assertion groups
 *   a. primitives + the token ramp (4px grid, 6/10/14/full radii, gutters)
 *   b. contrast floors: text roles, borders, badges, inverse-on-accent
 *   c. interaction + material: focus ring, motion band, reduced motion, blur
 *      only on the floating layer, weights 400/500/600, tabular numerals
 *   d. the mobile layout contract, re-asserted here so a token rewrite cannot
 *      silently drop it (tests/unit/mobileLayout.test.tsx covers the DOM half)
 *   e. backward compatibility: every class and every custom property that
 *      existed before the rewrite — or that src TSX files still references —
 *      is still defined.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/* ------------------------------------------------------------------ parsing */

interface CssRule {
  selectors: string[];
  declarations: string;
  /** Enclosing at-statements, outermost first (`@media (max-width: 768px)`). */
  atMedia: string[];
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * Hand-written CSS walker: returns every rule together with the at-statements
 * wrapping it. `@keyframes` bodies are skipped (their "selectors" are
 * percentages, not selectors) and top-level statements (`@import`) never leak
 * into the next selector because `;` resets the buffer.
 */
function parseRules(src: string, atMedia: string[] = []): CssRule[] {
  const rules: CssRule[] = [];
  let buffer = "";
  let index = 0;

  while (index < src.length) {
    const char = src[index];

    if (char === "{") {
      const selectorText = buffer.trim();
      buffer = "";
      let depth = 1;
      let cursor = index + 1;
      while (cursor < src.length && depth > 0) {
        if (src[cursor] === "{") depth += 1;
        else if (src[cursor] === "}") depth -= 1;
        cursor += 1;
      }
      const body = src.slice(index + 1, cursor - 1);
      index = cursor;

      if (selectorText.startsWith("@media") || selectorText.startsWith("@supports")) {
        rules.push(
          ...parseRules(body, [...atMedia, selectorText.replace(/\s+/g, " ")]),
        );
        continue;
      }
      if (selectorText.startsWith("@")) continue;

      rules.push({
        selectors: selectorText
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part.length > 0),
        declarations: body,
        atMedia,
      });
      continue;
    }

    if (char === ";" || char === "}") {
      buffer = "";
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

const CSS_PATH = resolve(process.cwd(), "src/index.css");
const CSS = stripComments(readFileSync(CSS_PATH, "utf8"));
const RULES = parseRules(CSS);
const TOP_LEVEL = RULES.filter((rule) => rule.atMedia.length === 0);

function findRule(
  selectorPredicate: (selector: string) => boolean,
  label: string,
): CssRule {
  const found = TOP_LEVEL.find((rule) => rule.selectors.some(selectorPredicate));
  if (!found) throw new Error(`index.css must declare a top-level block: ${label}`);
  return found;
}

const BASE_TOKENS = declarationMap(
  findRule((selector) => selector === ":root", ":root { ... }").declarations,
);

type ThemeName = "dark" | "light";

const THEMES: ThemeName[] = ["dark", "light"];

function themeTokens(theme: ThemeName): Map<string, string> {
  const block = findRule(
    (selector) =>
      new RegExp(`:root\\[data-theme=["']?${theme}["']?\\]?`).test(selector),
    `:root[data-theme="${theme}"] { ... }`,
  );
  return new Map([...BASE_TOKENS, ...declarationMap(block.declarations)]);
}

const TOKENS: Record<ThemeName, Map<string, string>> = {
  dark: themeTokens("dark"),
  light: themeTokens("light"),
};

function tokenValue(theme: ThemeName, token: string): string {
  const raw = TOKENS[theme].get(token) ?? BASE_TOKENS.get(token);
  if (raw === undefined) throw new Error(`${token} is not defined (${theme})`);
  return raw.trim();
}

/** Resolves a single `var(--x)` indirection chain to its raw value. */
function resolveToken(theme: ThemeName, token: string, depth = 0): string {
  const value = tokenValue(theme, token);
  const ref = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(value);
  if (!ref) return value;
  if (depth > 8) throw new Error(`var() cycle at ${token} (${theme})`);
  return resolveToken(theme, ref[1], depth + 1);
}

function tokensWithPrefix(theme: ThemeName, prefix: string): string[] {
  return [...TOKENS[theme].keys()].filter((name) => name.startsWith(prefix)).sort();
}

/* -------------------------------------------------------------- colour math */

interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

function gamma(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(color: Rgb): number {
  return (
    0.2126 * gamma(color.r) + 0.7152 * gamma(color.g) + 0.0722 * gamma(color.b)
  );
}

/** WCAG 2.1 contrast ratio; an alpha foreground is composited onto `back`. */
function contrastRatio(front: Rgb, back: Rgb): number {
  const blend = (c: number, bg: number): number =>
    c * front.a + bg * (1 - front.a);
  const flat: Rgb = {
    r: blend(front.r, back.r),
    g: blend(front.g, back.g),
    b: blend(front.b, back.b),
    a: 1,
  };
  const l1 = luminance(flat);
  const l2 = luminance(back);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
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

function firstComponent(raw: string): number {
  const token = raw.trim();
  if (/turn$/i.test(token)) return Number.parseFloat(token) * 360;
  return Number.parseFloat(token);
}

function alphaOf(raw: string): number {
  const token = raw.trim();
  return token.endsWith("%")
    ? Number.parseFloat(token) / 100
    : Number.parseFloat(token);
}

/** Supports #hex, rgb()/rgba() and hsl()/hsla() in comma or space syntax. */
function parseColor(raw: string): Rgb | null {
  const value = raw.trim();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (hex) {
    const digits = hex[1];
    const bytes =
      digits.length === 3
        ? digits.split("").map((d) => parseInt(d + d, 16))
        : [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
    return {
      r: bytes[0] / 255,
      g: bytes[1] / 255,
      b: bytes[2] / 255,
      a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
    };
  }

  const fn = /^(hsla?|rgba?)\(([^)]*)\)$/i.exec(value);
  if (!fn) return null;
  const args = fn[2]
    .split(/[\s,/]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const kind = fn[1].toLowerCase();
  const alpha = args.length > 3 ? alphaOf(args[3]) : 1;

  if (kind.startsWith("hsl")) {
    const rgb = hslToRgb(
      firstComponent(args[0]),
      Number.parseFloat(args[1]),
      Number.parseFloat(args[2]),
    );
    return { ...rgb, a: alpha };
  }

  const component = (token: string): number =>
    token.endsWith("%")
      ? (Number.parseFloat(token) / 100) * 255
      : Number.parseFloat(token);
  return {
    r: component(args[0]) / 255,
    g: component(args[1]) / 255,
    b: component(args[2]) / 255,
    a: alpha,
  };
}

function colorOf(theme: ThemeName, token: string): Rgb {
  const raw = resolveToken(theme, token);
  const parsed = parseColor(raw);
  if (!parsed) throw new Error(`${token} is not a colour (${theme}): "${raw}"`);
  return parsed;
}

function ratio(theme: ThemeName, frontToken: string, backToken: string): number {
  return contrastRatio(colorOf(theme, frontToken), colorOf(theme, backToken));
}

function px(theme: ThemeName, token: string): number {
  const raw = resolveToken(theme, token);
  if (/rem$|em$/.test(raw)) return Number.parseFloat(raw) * 16;
  return Number.parseFloat(raw);
}

/* ---------------------------------------------------------------- selectors */

/** Every class name the stylesheet defines, CSS escapes decoded. */
function definedClasses(): Set<string> {
  const out = new Set<string>();
  for (const rule of RULES) {
    for (const selector of rule.selectors) {
      // `\:` is a CSS escape, `:` starts a pseudo-class: decode the escape
      // into a private marker so both survive the token scan.
      const decoded = selector.replace(/\\:/g, "\u0001");
      const re = /\.([A-Za-z][A-Za-z0-9_\u0001-]*)/g;
      let match = re.exec(decoded);
      while (match !== null) {
        out.add(match[1].split("\u0001").join(":"));
        match = re.exec(decoded);
      }
    }
  }
  return out;
}

function rulesMatching(...classNames: string[]): CssRule[] {
  return RULES.filter((rule) =>
    rule.selectors.some((selector) =>
      classNames.some((name) => selector.includes(`.${name}`)),
    ),
  );
}

/** Base (non-media) declarations of `.<className>`. */
function declarationsFor(className: string): Map<string, string> {
  const merged = new Map<string, string>();
  for (const rule of rulesMatching(className)) {
    if (rule.atMedia.length > 0) continue;
    if (!rule.selectors.some((selector) => selector.trim() === `.${className}`)) {
      continue;
    }
    for (const [prop, value] of declarationMap(rule.declarations)) {
      merged.set(prop, value);
    }
  }
  return merged;
}

function mediaBlock(prelude: string): CssRule[] {
  return RULES.filter((rule) =>
    rule.atMedia.some((at) => at.replace(/\s+/g, " ") === prelude),
  );
}

/* ------------------------------------------------------------- source scan */

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(full, out);
    else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const SRC_DIR = resolve(process.cwd(), "src");
const SOURCE_FILES = listSourceFiles(SRC_DIR);
const VIEW_FILES = SOURCE_FILES.filter((file) => file.endsWith(".tsx"));

/**
 * A class-name token. Tailwind-style variant prefixes (`hover:bg-blue-700`)
 * are allowed; dotted strings (`session.status`) are property paths, never
 * class names, so they are excluded.
 */
const CLASS_TOKEN = /^[a-z][a-z0-9_-]*(:[a-z0-9_-]+)?$/;

function addTokens(
  into: Map<string, string[]>,
  value: string,
  file: string,
): void {
  for (const token of value.trim().split(/\s+/)) {
    if (!CLASS_TOKEN.test(token)) continue;
    into.set(token, [...(into.get(token) ?? []), file]);
  }
}

/** `className="..."` literals: every token must be a defined class. */
function staticClassNames(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of VIEW_FILES) {
    const source = readFileSync(file, "utf8");
    const re = /className\s*=\s*"([^"]*)"/g;
    let match = re.exec(source);
    while (match !== null) {
      addTokens(found, match[1], file);
      match = re.exec(source);
    }
  }
  return found;
}

/** Class-ish tokens inside `className={...}` expressions. */
function dynamicClassNames(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of VIEW_FILES) {
    const source = readFileSync(file, "utf8");
    let index = 0;
    while (true) {
      const at = source.indexOf("className={", index);
      if (at < 0) break;
      let depth = 1;
      let cursor = at + "className={".length;
      while (cursor < source.length && depth > 0) {
        if (source[cursor] === "{") depth += 1;
        else if (source[cursor] === "}") depth -= 1;
        cursor += 1;
      }
      const body = source.slice(at + "className={".length, cursor - 1);
      const re = /["'`]([^"'`\n]*)["'`]/g;
      let match = re.exec(body);
      while (match !== null) {
        if (!match[1].includes("${")) addTokens(found, match[1], file);
        match = re.exec(body);
      }
      index = cursor;
    }
  }
  return found;
}

/** `var(--x)` names referenced from the app (inline styles included). */
function referencedCustomProperties(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of SOURCE_FILES) {
    const source = readFileSync(file, "utf8");
    const re = /var\(\s*(--[\w-]+)/g;
    let match = re.exec(source);
    while (match !== null) {
      found.set(match[1], [...(found.get(match[1]) ?? []), file]);
      match = re.exec(source);
    }
  }
  return found;
}

/**
 * Right-hand operands of a string comparison: these are values the view
 * branches on (`session.status === 'active'`), not class names.
 */
function comparedStringValues(): Set<string> {
  const out = new Set<string>();
  for (const file of VIEW_FILES) {
    const source = readFileSync(file, "utf8");
    const re = /(?:===|!==|==)\s*(["'`])([^"'`\n]*)\1/g;
    let match = re.exec(source);
    while (match !== null) {
      if (match[2].trim()) out.add(match[2].trim());
      match = re.exec(source);
    }
  }
  return out;
}

/* ------------------------------------------------------------ expectations */

/** Spec §12 "Primitives to own" — every view builds on these class names. */
const PRIMITIVES = [
  "app-shell",
  "page",
  "page-header",
  "page-title",
  "page-actions",
  "list",
  "list-row",
  "list-row-main",
  "list-row-meta",
  "card",
  "stat",
  "stat-value",
  "stat-label",
  "btn",
  "btn-primary",
  "btn-secondary",
  "btn-ghost",
  "btn-icon",
  "field",
  "field-label",
  "input",
  "select",
  "switch",
  "badge",
  "badge-success",
  "badge-warning",
  "badge-error",
  "badge-info",
  "empty",
  "sheet",
  "sheet-body",
  "sheet-footer",
  "toast",
  "skeleton",
] as const;

/** Text-role contrast floors (spec §12 "Color"). */
const TEXT_FLOORS: Record<string, number> = {
  "--color-text-primary": 12,
  "--color-text-secondary": 7,
  "--color-text-tertiary": 4.5,
  "--color-text-muted": 4.5,
};

/** The surfaces copy actually sits on. */
const TEXT_SURFACES = ["--color-bg-primary", "--color-bg-secondary"];

/** Border tokens that must stay visible against their adjacent surfaces. */
const BORDER_TOKENS = [
  "--color-border",
  "--color-border-hover",
  "--color-border-focus",
  "--color-border-glass",
  "--color-border-subtle",
];

const SURFACES = [
  "--color-bg-primary",
  "--color-bg-secondary",
  "--color-bg-tertiary",
];

/** Type step -> the colour role it is allowed to render in, and its floor. */
const TYPE_ROLE_PAIRS: Array<{ size: string; role: string; floor: number }> = [
  { size: "--text-xs", role: "--color-text-tertiary", floor: 4.5 },
  { size: "--text-sm", role: "--color-text-secondary", floor: 7 },
  { size: "--text-base", role: "--color-text-primary", floor: 12 },
  { size: "--text-lg", role: "--color-text-primary", floor: 12 },
  { size: "--text-xl", role: "--color-text-primary", floor: 12 },
  { size: "--text-2xl", role: "--color-text-primary", floor: 12 },
  { size: "--text-3xl", role: "--color-text-primary", floor: 12 },
  { size: "--text-4xl", role: "--color-text-primary", floor: 12 },
  { size: "--text-5xl", role: "--color-text-primary", floor: 12 },
];

const SIZE_TOKENS = TYPE_ROLE_PAIRS.map((pair) => pair.size);

/** State badge text on its own solid tint. */
const BADGE_PAIRS: Array<[string, string]> = [
  ["--color-success", "--color-success-bg"],
  ["--color-warning", "--color-warning-bg"],
  ["--color-error", "--color-error-bg"],
  ["--color-info", "--color-info-bg"],
];

/**
 * Classes defined by the pre-rewrite index.css. Deleting any of them breaks a
 * view that still references it, which is a regression, not a cleanup.
 */
const LEGACY_CLASSES = [
  "admin-page",
  "animate-breathe",
  "animate-fade-in",
  "animate-float",
  "animate-pulse",
  "animate-slide-in-left",
  "animate-slide-in-right",
  "auth-page",
  "badge",
  "badge-error",
  "badge-info",
  "badge-pulse",
  "badge-success",
  "badge-warning",
  "border-gradient",
  "btn-danger",
  "btn-ghost",
  "btn-primary",
  "btn-secondary",
  "file-panel",
  "focus-ring",
  "glass-card",
  "glass-modal",
  "glass-sidebar",
  "hamburger-btn",
  "hide-mobile",
  "hide-tablet",
  "kb-table",
  "kb-table-scroll",
  "liquid-blob-1",
  "liquid-blob-2",
  "liquid-blob-3",
  "liquid-blob-container",
  "liquid-glass-card",
  "mobile-btn-stack",
  "mobile-full-width",
  "mobile-header",
  "mobile-main",
  "mobile-p-4",
  "mobile-sidebar",
  "neon-glow-primary",
  "neon-glow-secondary",
  "neon-glow-success",
  "no-print",
  "open",
  "playground-pane-chat",
  "playground-pane-settings",
  "playground-shell",
  "rainbow-border",
  "responsive-flex-col",
  "responsive-grid-2",
  "responsive-grid-3",
  "show-mobile",
  "sidebar-overlay",
  "spinner",
  "stagger-1",
  "stagger-2",
  "stagger-3",
  "stagger-4",
  "stagger-5",
  "text-gradient",
  "tooltip",
  "url-panel",
];

/** Custom property names defined by the pre-rewrite index.css. */
const LEGACY_CUSTOM_PROPERTIES = [
  "--blur-lg",
  "--blur-md",
  "--blur-sm",
  "--blur-xl",
  "--color-accent-glow",
  "--color-accent-gradient",
  "--color-accent-primary",
  "--color-accent-secondary",
  "--color-bg-elevated",
  "--color-bg-glass",
  "--color-bg-panel",
  "--color-bg-primary",
  "--color-bg-secondary",
  "--color-bg-tertiary",
  "--color-border",
  "--color-border-focus",
  "--color-border-glass",
  "--color-border-hover",
  "--color-error",
  "--color-error-bg",
  "--color-info",
  "--color-info-bg",
  "--color-shadow",
  "--color-shadow-sm",
  "--color-success",
  "--color-success-bg",
  "--color-text-inverse",
  "--color-text-muted",
  "--color-text-primary",
  "--color-text-secondary",
  "--color-warning",
  "--color-warning-bg",
  "--font-display",
  "--font-mono",
  "--glass-blur-card",
  "--glass-blur-modal",
  "--glass-blur-sidebar",
  "--glass-blur-surface",
  "--radius-full",
  "--radius-lg",
  "--radius-md",
  "--radius-sm",
  "--radius-xl",
  "--shadow-glow",
  "--shadow-glow-lg",
  "--shadow-inner-glow",
  "--shadow-lg",
  "--shadow-md",
  "--shadow-sm",
  "--shadow-xl",
  "--sidebar-bg",
  "--sidebar-collapsed",
  "--sidebar-user-bg",
  "--sidebar-width",
  "--space-1",
  "--space-10",
  "--space-12",
  "--space-16",
  "--space-2",
  "--space-20",
  "--space-3",
  "--space-4",
  "--space-5",
  "--space-6",
  "--space-8",
  "--text-2xl",
  "--text-3xl",
  "--text-4xl",
  "--text-5xl",
  "--text-base",
  "--text-lg",
  "--text-sm",
  "--text-xl",
  "--text-xs",
  "--transition-base",
  "--transition-bounce",
  "--transition-fast",
  "--transition-slow",
  "--transition-spring",
];

/**
 * Tokens picked up inside a `className={...}` expression that are compared
 * values rather than class names (derived by reading every call site).
 */
const NON_CLASS_TOKENS = ["assistant"];

/** Selectors allowed to blur: the floating functional layer only. */
const FLOATING_LAYER = [
  ".glass-sidebar",
  ".glass-modal",
  ".sheet",
  ".sidebar-overlay",
  ".mobile-header",
  ".tooltip",
];

/** Expands every `var()` in a declaration value against the theme tokens. */
function expandVars(theme: ThemeName, value: string): string {
  let out = value;
  for (let step = 0; step < 8; step += 1) {
    const next = out.replace(
      /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g,
      (_match: string, name: string, fallback?: string): string => {
        const raw = TOKENS[theme].get(name) ?? BASE_TOKENS.get(name);
        if (raw !== undefined) return raw.trim();
        return fallback !== undefined ? fallback.trim() : "";
      },
    );
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s+/g, " ").trim();
}

function literalColorsIn(value: string): string[] {
  return (
    value.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/g) ?? []
  ).filter((token) => !/^[a-z]+\(.*var\(/i.test(token));
}

describe("design tokens: primitives and the ramp (spec §12 a)", () => {
  it("owns every primitive the spec lists, as a real styled class", () => {
    const classes = definedClasses();
    const missing = PRIMITIVES.filter((name) => !classes.has(name));
    expect(missing, "spec §12 primitives must exist as classes").toEqual([]);

    const bare = PRIMITIVES.filter(
      (name) => declarationsFor(name).size === 0,
    );
    expect(bare, "every primitive must carry declarations").toEqual([]);

    // The badge states the views actually render.
    for (const state of ["success", "warning", "error", "info"]) {
      expect(classes.has(`badge-${state}`), `.badge-${state} must exist`).toBe(
        true,
      );
    }
  });

  it("keeps spacing on a 4px grid, radii at 6/10/14/full and gutters at 16/24/32", () => {
    const theme = "dark";
    const spacing = tokensWithPrefix(theme, "--space-");
    expect(spacing.length, "the spacing ramp must survive").toBeGreaterThanOrEqual(11);
    expect(px(theme, "--space-1")).toBe(4);
    for (const token of spacing) {
      expect(px(theme, token) % 4, `${token} must sit on the 4px grid`).toBe(0);
    }

    expect(px(theme, "--radius-sm")).toBe(6);
    expect(px(theme, "--radius-md")).toBe(10);
    expect(px(theme, "--radius-lg")).toBe(14);
    expect(px(theme, "--radius-full")).toBeGreaterThanOrEqual(9999);
    const radiusRamp = ["--radius-sm", "--radius-md", "--radius-lg", "--radius-xl"].map(
      (token) => px(theme, token),
    );
    for (const value of radiusRamp) {
      expect([6, 10, 14], `${value}px must be one of the three radii`).toContain(value);
    }

    expect(px(theme, "--page-gutter-mobile")).toBe(16);
    expect(px(theme, "--page-gutter")).toBe(24);
    expect(px(theme, "--page-gutter-wide")).toBe(32);
  });

  it("declares exactly the intended --text-* scale with an intentional admin ramp", () => {
    const theme = "dark";
    expect(
      tokensWithPrefix(theme, "--text-").sort(),
      "no orphan or duplicate size token",
    ).toEqual([...SIZE_TOKENS].sort());

    expect(px(theme, "--text-xs")).toBe(12); // caption
    expect(px(theme, "--text-base")).toBeGreaterThanOrEqual(14); // admin body
    expect(px(theme, "--text-base")).toBeLessThanOrEqual(15);
    expect(px(theme, "--text-lg")).toBeGreaterThanOrEqual(15); // section title
    // The polish wave pins the new intermediate section step exactly: 17px.
    expect(px(theme, "--text-lg")).toBe(17);
    expect(px(theme, "--text-2xl")).toBeGreaterThanOrEqual(22); // page title
    expect(px(theme, "--text-2xl")).toBeLessThanOrEqual(24);

    const titleFontWeight = expandVars(theme, String(declarationsFor("page-title").get("font-weight")));
    expect(titleFontWeight, "page titles are semibold").toContain("600");
  });
});

describe("design tokens: contrast floors in both themes (spec §12 b)", () => {
  it("holds the text-role floors on both backgrounds, dark and light", () => {
    for (const theme of THEMES) {
      for (const [token, floor] of Object.entries(TEXT_FLOORS)) {
        for (const surface of TEXT_SURFACES) {
          expect(
            ratio(theme, token, surface),
            `${token} on ${surface} (${theme}) must be >= ${floor}:1`,
          ).toBeGreaterThanOrEqual(floor);
        }
      }
    }
  });

  it("pairs every --text-* step with a colour role that clears its floor", () => {
    for (const theme of THEMES) {
      for (const pair of TYPE_ROLE_PAIRS) {
        expect(
          tokensWithPrefix(theme, "--color-text-"),
          `${theme} needs the role colour for ${pair.size}`,
        ).toContain(pair.role);
        for (const surface of TEXT_SURFACES) {
          expect(
            ratio(theme, pair.role, surface),
            `${pair.size} renders in ${pair.role} on ${surface} (${theme})`,
          ).toBeGreaterThanOrEqual(pair.floor);
        }
      }
    }
  });

  it("paints every emphasise-me element in the strongest text role", () => {
    const EMPHASIS = [
      "page-title",
      "card-title",
      "empty-title",
      "list-row-title",
      "stat-value",
      "sheet-header",
    ];
    for (const theme of THEMES) {
      const strongest = tokenValue(theme, "--color-text-primary");
      expect(
        resolveToken(theme, "--fg-strong"),
        `--fg-strong must resolve to the strongest text role (${theme})`,
      ).toBe(strongest);
      for (const emphasis of EMPHASIS) {
        const declared = String(declarationsFor(emphasis).get("color") ?? "");
        expect(
          declared,
          `.${emphasis} must paint through --fg-strong`,
        ).toBe("var(--fg-strong)");
        expect(
          expandVars(theme, declared),
          `.${emphasis} must resolve to the strongest text colour (${theme})`,
        ).toBe(strongest);
        expect(
          ratio(theme, "--color-text-primary", "--color-bg-secondary"),
          `emphasis text must clear 12:1 (${theme})`,
        ).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it("keeps borders visible and badge / button text legible", () => {
    for (const theme of THEMES) {
      for (const border of BORDER_TOKENS) {
        for (const surface of SURFACES) {
          expect(
            ratio(theme, border, surface),
            `${border} against ${surface} (${theme}) must be >= 3:1`,
          ).toBeGreaterThanOrEqual(3);
        }
      }

      for (const [state, tint] of BADGE_PAIRS) {
        expect(
          ratio(theme, state, tint),
          `badge ${state} on ${tint} (${theme})`,
        ).toBeGreaterThanOrEqual(4.5);
        for (const surface of TEXT_SURFACES) {
          expect(
            ratio(theme, state, surface),
            `state text ${state} on ${surface} (${theme})`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }

      // Primary action: white-ish label on the single accent.
      expect(
        ratio(theme, "--color-text-inverse", "--color-accent-primary"),
        `btn-primary label on accent (${theme})`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        ratio(theme, "--color-accent-primary", "--color-bg-secondary"),
        `accent as link text (${theme})`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("design tokens: interaction and material (spec §12 c)", () => {
  it("shows one 2px focus ring with a 2px offset and never removes it", () => {
    const focusRules = RULES.filter((rule) =>
      rule.selectors.some((selector) => selector.includes(":focus-visible")),
    );
    expect(focusRules.length, ":focus-visible must be styled").toBeGreaterThan(0);

    for (const theme of THEMES) {
      const focusDecls = declarationMap(focusRules[0].declarations);
      const ring = expandVars(theme, String(focusDecls.get("outline") ?? ""));
      expect(ring, "the focus ring is 2px solid").toMatch(/^2px solid /);
      expect(
        resolveToken(theme, "--focus-ring"),
        "the focus ring colour is the focus token",
      ).toContain("--color-border-focus");
      expect(ring).toContain(tokenValue(theme, "--color-border-focus"));
      const offset = expandVars(
        theme,
        String(focusDecls.get("outline-offset") ?? ""),
      );
      expect(offset, "the focus ring offset is 2px").toBe("2px");
    }

    const killed = RULES.filter((rule) =>
      [...declarationMap(rule.declarations)].some(
        ([prop, value]) =>
          prop.startsWith("outline") && /^(none|0(\.0)?(px)?)$/i.test(value.trim()),
      ),
    );
    expect(
      killed.map((rule) => rule.selectors.join(", ")),
      "no rule may remove the focus outline",
    ).toEqual([]);
  });

  it("keeps motion in the 120-200ms band, honours reduced motion, weights 400/500/600", () => {
    for (const theme of THEMES) {
      for (const token of ["--duration-fast", "--duration-base", "--duration-slow"]) {
        const ms = Number.parseFloat(resolveToken(theme, token));
        expect(ms, `${token} must be a ms duration`).toBeGreaterThanOrEqual(120);
        expect(ms, `${token} must be a ms duration`).toBeLessThanOrEqual(200);
      }
      for (const token of tokensWithPrefix(theme, "--transition-")) {
        const expanded = expandVars(theme, resolveToken(theme, token));
        const durations = [...expanded.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)].map(
          (match) =>
            match[2] === "s"
              ? Number.parseFloat(match[1]) * 1000
              : Number.parseFloat(match[1]),
        );
        expect(durations.length, `${token} must declare a duration`).toBeGreaterThan(0);
        for (const ms of durations) {
          expect(ms, `${token} = ${ms}ms must sit in 120-200ms`).toBeGreaterThanOrEqual(120);
          expect(ms, `${token} = ${ms}ms must sit in 120-200ms`).toBeLessThanOrEqual(200);
        }
      }
      for (const token of tokensWithPrefix(theme, "--weight-")) {
        expect([400, 500, 600], `${token} must be 400/500/600`).toContain(
          Number.parseInt(resolveToken(theme, token), 10),
        );
      }
    }

    const slowTransitions = RULES.flatMap((rule) => {
      const offenders: string[] = [];
      if (rule.atMedia.some((at) => at.includes("prefers-reduced-motion"))) return offenders;
      for (const [prop, value] of declarationMap(rule.declarations)) {
        if (!prop.startsWith("transition")) continue;
        for (const match of value.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)) {
          const ms = match[2] === "s" ? Number.parseFloat(match[1]) * 1000 : Number.parseFloat(match[1]);
          if (ms > 200) offenders.push(`${rule.selectors.join(", ")} -> ${prop}: ${value}`);
        }
      }
      return offenders;
    });
    expect(slowTransitions, "transitions are 120-200ms").toEqual([]);

    expect(
      CSS,
      "prefers-reduced-motion must be honoured",
    ).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    const reduced = mediaBlock("@media (prefers-reduced-motion: reduce)");
    expect(reduced.length).toBeGreaterThan(0);
    expect(
      reduced.some((rule) => /transition-duration:\s*0\.01ms\s*!important/.test(rule.declarations)),
      "reduced motion must neutralise transition duration",
    ).toBe(true);

    expect(
      (CSS.match(/font-weight:\s*(?:300|700|800|900)\b/g) ?? []).length,
      "only 400/500/600 weights are allowed",
    ).toBe(0);
    expect(CSS, "the font request must not load weight 300 or 700+").toMatch(
      /family=Outfit:wght@400;500;600/,
    );
  });

  it("restricts blur to the floating layer and keeps content surfaces solid", () => {
    const blurred = RULES.filter((rule) =>
      /backdrop-filter\s*:/.test(rule.declarations),
    );
    expect(blurred.length, "the floating layer is blurred").toBeGreaterThan(0);
    const offenders = blurred
      .filter(
        (rule) =>
          !rule.selectors.every((selector) =>
            FLOATING_LAYER.some((allowed) => selector.includes(allowed)),
          ),
      )
      .map((rule) => rule.selectors.join(", "));
    expect(offenders, "blur is a floating-layer effect only").toEqual([]);

    for (const theme of THEMES) {
      expect(
        px(theme, "--glass-blur-card"),
        "content cards are solid, not glass",
      ).toBe(0);
      expect(px(theme, "--glass-blur-surface")).toBe(0);
      expect(px(theme, "--glass-blur-sidebar")).toBeGreaterThan(0);
      expect(px(theme, "--glass-blur-modal")).toBeGreaterThan(0);
    }

    // Aurora backdrops are gone from content areas.
    const blobs = declarationsFor("liquid-blob-2");
    expect(String(blobs.get("display"))).toBe("none");
    const float = declarationsFor("animate-float");
    expect(String(float.get("animation"))).toBe("none");

    const literals = RULES.filter(
      (rule) => !rule.selectors.some((selector) => selector.startsWith(":root")),
    )
      .flatMap((rule) =>
        [...declarationMap(rule.declarations)].filter(
          ([prop]) =>
            /^(color|background|background-color|border|border-color|box-shadow|outline|fill|stroke)$/.test(
              prop,
            ),
        ),
      )
      .filter(([, value]) => literalColorsIn(value).length > 0)
      .map(([prop, value]) => `${prop}: ${value}`);
    expect(literals, "no literal colour outside the token blocks").toEqual([]);
  });

  it("uses tabular numerals wherever numbers are compared", () => {
    for (const className of ["stat-value", "list-row-meta"]) {
      expect(
        String(declarationsFor(className).get("font-variant-numeric")),
        `.${className} must render tabular numerals`,
      ).toBe("tabular-nums");
    }
    const cells = RULES.find((rule) => rule.selectors.includes("td"));
    expect(cells, "table cells exist").not.toEqual(undefined);
    expect(String(declarationMap((cells as CssRule).declarations).get("font-variant-numeric"))).toBe(
      "tabular-nums",
    );
  });
});

describe("design tokens: the mobile layout contract (spec §12 d)", () => {
  const MOBILE_PRELUDE = "@media (max-width: 768px)";
  const DESKTOP_PRELUDE = "@media (min-width: 1025px)";
  const mobile = mediaBlock(MOBILE_PRELUDE);

  function mobileDecl(selector: string, property: string): string[] {
    return mobile
      .filter((rule) => rule.selectors.includes(selector))
      .map((rule) => declarationMap(rule.declarations).get(property))
      .filter((value): value is string => value !== undefined);
  }

  it("declares the 375px width contract inside the mobile media block", () => {
    expect(mobile.length, `${MOBILE_PRELUDE} must exist`).toBeGreaterThan(0);
    expect(
      CSS.split(MOBILE_PRELUDE).length - 1,
      "there must be exactly one mobile media block",
    ).toBe(1);

    expect(mobileDecl(".admin-page", "overflow-x")).toContain("hidden");
    expect(mobileDecl(".mobile-main", "overflow-x")).toContain("hidden");
    expect(mobileDecl(".kb-table-scroll", "overflow-x")).toContain("auto");
    expect(mobileDecl(".kb-table", "min-width")).toContain("640px");
    // The desktop 24px gutter must collapse to the 16px mobile gutter.
    expect(mobileDecl(".admin-page", "padding")).toContain("var(--space-4) !important");
    expect(mobileDecl(":root", "--sidebar-width")).toContain("100%");
  });

  it("declares 44px tap targets and keeps the hamburger above the content", () => {
    const tapTarget = mobile.find((rule) =>
      rule.selectors.includes(".admin-page button"),
    );
    expect(tapTarget, ".admin-page button must have a mobile tap-target rule").not.toEqual(
      undefined,
    );
    expect(String(declarationMap((tapTarget as CssRule).declarations).get("min-height"))).toBe(
      "44px",
    );

    const hamburger = mobileDecl(".hamburger-btn", "width");
    const hamburgerHeight = mobileDecl(".hamburger-btn", "height");
    const hamburgerMin = mobileDecl(".hamburger-btn", "min-height");
    const hamburgerZ = mobileDecl(".hamburger-btn", "z-index");
    expect(hamburger).toContain("44px");
    expect(hamburgerHeight).toContain("44px");
    expect(hamburgerMin).toContain("44px");
    expect(hamburgerZ).toContain("45");

    // The spacing ramp behind the primitives agrees with the media block.
    for (const theme of THEMES) {
      expect(px(theme, "--space-4")).toBe(16);
    }
  });

  it("stacks the playground tabs at mobile width and never in the desktop block", () => {
    const shell = mobileDecl(".playground-shell", "flex-direction");
    expect(shell).toContain("column");
    expect(mobileDecl(".playground-shell", "overflow-x")).toContain("hidden");

    // The tab strip spans the header at 375px and each tab is a 44px target.
    expect(mobileDecl(".playground-tabs", "width")).toContain("100%");
    expect(mobileDecl(".playground-tab", "min-height")).toContain("44px");

    const desktopAt = CSS.indexOf(DESKTOP_PRELUDE);
    expect(desktopAt, `${DESKTOP_PRELUDE} must exist`).toBeGreaterThan(0);
    expect(CSS.indexOf(MOBILE_PRELUDE), "mobile before desktop").toBeLessThan(desktopAt);
    const afterDesktop = CSS.slice(desktopAt);
    expect(afterDesktop).not.toMatch(/\.playground-shell/);
    expect(afterDesktop).not.toMatch(/\.playground-pane-settings/);
    expect(afterDesktop).not.toMatch(/\.hamburger-btn/);
  });
});

describe("design tokens: backward compatibility (spec §12 e)", () => {
  it("still defines every class the previous stylesheet defined", () => {
    const classes = definedClasses();
    const missing = LEGACY_CLASSES.filter((name) => !classes.has(name));
    expect(missing, "legacy classes may not be deleted").toEqual([]);
  });

  it("defines every class that src/**/*.tsx references statically", () => {
    const classes = definedClasses();
    const used = staticClassNames();
    expect(used.size, "the scan must find the view classes").toBeGreaterThan(40);
    const undefined = [...used.keys()].filter((name) => !classes.has(name));
    expect(
      undefined.map((name) => `${name} <- ${used.get(name)?.[0]}`),
      "a view uses a class index.css does not define",
    ).toEqual([]);

    const compared = comparedStringValues();
    const dynamic = dynamicClassNames();
    expect(dynamic.size, "views also branch classNames dynamically").toBeGreaterThan(0);
    const loose = [...dynamic.keys()].filter(
      (name) =>
        !classes.has(name) && !NON_CLASS_TOKENS.includes(name) && !compared.has(name),
    );
    expect(
      loose.map((name) => `${name} <- ${dynamic.get(name)?.[0]}`),
      "dynamic className expressions must resolve to real classes",
    ).toEqual([]);
  });

  it("keeps every custom property name alive in both themes", () => {
    const darkKeys = new Set(TOKENS.dark.keys());
    const lightKeys = new Set(TOKENS.light.keys());
    const missingDark = LEGACY_CUSTOM_PROPERTIES.filter((name) => !darkKeys.has(name));
    const missingLight = LEGACY_CUSTOM_PROPERTIES.filter((name) => !lightKeys.has(name));
    expect(missingDark, "legacy tokens may not be deleted (dark)").toEqual([]);
    expect(missingLight, "legacy tokens may not be deleted (light)").toEqual([]);

    const referenced = referencedCustomProperties();
    expect(referenced.size, "views reference token names").toBeGreaterThan(30);
    const dangling = [...referenced.keys()].filter(
      (name) => !darkKeys.has(name) || !lightKeys.has(name),
    );
    expect(
      dangling.map((name) => `${name} <- ${referenced.get(name)?.[0]}`),
      "inline styles must not point at a token that does not exist in both themes",
    ).toEqual([]);
  });
});

/* =============================================================================
 * Polish wave A (lane TYPO) — spec §1 + §3.
 *
 * The light theme is the appearance the product actually ships in, and it was
 * the weaker one: the page and the card were a ~1.07:1 value step and the card
 * and the raised surface were identical, so elevation could only be read from a
 * 1px border. These assertions pin a real three-level light ramp, a hairline
 * that clears the spec floor, one resting/raised shadow pair per theme wired to
 * the surfaces, the 17px section step, and the `.mono` machine-string utility.
 * ============================================================================= */
describe("design tokens: light ramp, elevation and the section step (polish wave A)", () => {
  /** Every `hsl(...)`/`rgb(...)` operand inside a (possibly multi-layer) shadow. */
  function shadowColors(value: string): Rgb[] {
    return (value.match(/(?:hsla?|rgba?)\([^)]*\)/g) ?? [])
      .map((token) => parseColor(token))
      .filter((colour): colour is Rgb => colour !== null);
  }

  it("light theme is a three-level ramp, not a two-tone page", () => {
    // Page (dimmed) -> surface (card/list) -> raised (popover/sheet).
    expect(
      ratio("light", "--color-bg-primary", "--color-bg-secondary"),
      "light page -> surface must be a visible step (>= 1.10:1)",
    ).toBeGreaterThanOrEqual(1.1);
    expect(
      ratio("light", "--color-bg-secondary", "--color-bg-elevated"),
      "light surface -> raised must separate (>= 1.04:1)",
    ).toBeGreaterThanOrEqual(1.04);
    expect(
      ratio("light", "--color-bg-primary", "--color-bg-elevated"),
      "light page -> raised must separate (>= 1.15:1)",
    ).toBeGreaterThanOrEqual(1.15);

    // A light page must be darker than a light card, or the ramp is inverted.
    const page = luminance(colorOf("light", "--color-bg-primary"));
    const surface = luminance(colorOf("light", "--color-bg-secondary"));
    expect(
      page,
      "the light page must sit below the light surface in luminance",
    ).toBeLessThan(surface);

    // The dark ramp keeps the quality it shipped with. Dark colours are frozen
    // by the spec, so these are non-regression floors at the shipped values:
    // page->surface 1.066:1, surface->raised 1.053:1, page->raised 1.122:1.
    expect(
      ratio("dark", "--color-bg-primary", "--color-bg-secondary"),
      "dark page -> surface must stay >= 1.05:1",
    ).toBeGreaterThanOrEqual(1.05);
    expect(
      ratio("dark", "--color-bg-secondary", "--color-bg-elevated"),
      "dark surface -> raised must stay >= 1.05:1",
    ).toBeGreaterThanOrEqual(1.05);
    expect(
      ratio("dark", "--color-bg-primary", "--color-bg-elevated"),
      "dark page -> raised must stay >= 1.10:1",
    ).toBeGreaterThanOrEqual(1.1);

    // The spec freezes the dark ramp at its shipped quality, so pin the three
    // dark surface values: a "polish" pass may not dim or lift them.
    expect(
      [
        resolveToken("dark", "--color-bg-primary"),
        resolveToken("dark", "--color-bg-secondary"),
        resolveToken("dark", "--color-bg-elevated"),
        resolveToken("dark", "--color-bg-tertiary"),
      ],
      "the dark surface ramp must stay exactly as shipped",
    ).toEqual([
      "hsl(220, 16%, 7%)",
      "hsl(220, 15%, 10%)",
      "hsl(220, 14%, 12%)",
      "hsl(220, 13%, 14%)",
    ]);
  });

  it("the hairline border reads against the page", () => {
    // Spec §1 floor: the hairline must be findable at >= 1.4:1 on the page.
    expect(
      ratio("light", "--color-border", "--color-bg-primary"),
      "the light hairline must clear the 1.4:1 spec floor against the page",
    ).toBeGreaterThanOrEqual(1.4);
  });

  it("every theme owns a resting/raised elevation pair and the surfaces use it", () => {
    for (const theme of THEMES) {
      for (const token of ["--elevation-resting", "--elevation-raised"]) {
        expect(
          tokensWithPrefix(theme, token),
          `${theme} must declare ${token}`,
        ).toContain(token);

        const value = expandVars(theme, resolveToken(theme, token));
        expect(
          value,
          `${token} (${theme}) must be a real shadow, not "none"`,
        ).not.toMatch(/^none$/i);
        expect(
          value,
          `${token} (${theme}) must offset by a px value`,
        ).toMatch(/-?\d+(?:\.\d+)?px/);

        const colours = shadowColors(value);
        expect(
          colours.length,
          `${token} (${theme}) must declare a shadow colour`,
        ).toBeGreaterThan(0);
        for (const colour of colours) {
          expect(
            colour.a,
            `${token} (${theme}) must be translucent, not a solid grey`,
          ).toBeLessThan(1);
        }
      }
    }

    // The elevation pair is the depth cue the primitives actually paint with.
    expect(
      declarationsFor("card").get("box-shadow"),
      ".card must paint the resting elevation",
    ).toBe("var(--elevation-resting)");
    expect(
      declarationsFor("card-raised").get("box-shadow"),
      ".card-raised must paint the raised elevation",
    ).toBe("var(--elevation-raised)");
    expect(
      declarationsFor("sheet").get("box-shadow"),
      ".sheet must paint the raised elevation",
    ).toBe("var(--elevation-raised)");
  });

  it("adds the 17px section step and uses it for panel headings", () => {
    for (const theme of THEMES) {
      expect(
        px(theme, "--text-lg"),
        `--text-lg is the intermediate section step (${theme})`,
      ).toBe(17);
    }

    for (const className of ["card-title", "sheet-header", "empty-title"]) {
      expect(
        declarationsFor(className).get("font-size"),
        `.${className} must render at the section step`,
      ).toBe("var(--text-lg)");
      expect(
        expandVars("light", String(declarationsFor(className).get("font-weight"))),
        `.${className} must stay weight 500 at the section step`,
      ).toBe("500");
    }
  });

  it("the .mono utility renders machine strings in the mono face", () => {
    expect(
      definedClasses().has("mono"),
      "index.css must define the .mono utility",
    ).toBe(true);

    const families = expandVars("light", String(declarationsFor("mono").get("font-family")));
    expect(
      families,
      ".mono must resolve to the mono typeface",
    ).toContain("JetBrains Mono");
    expect(
      declarationsFor("mono").get("font-variant-numeric"),
      ".mono must render tabular figures",
    ).toBe("tabular-nums");

    // The two machine-string call sites must opt in.
    const dashboard = readFileSync(
      resolve(process.cwd(), "src/views/Dashboard.tsx"),
      "utf8",
    );
    const kbDetail = readFileSync(
      resolve(process.cwd(), "src/views/KnowledgeBaseDetail.tsx"),
      "utf8",
    );
    expect(
      /className\s*=\s*["'`][^"'`]*\bmono\b/.test(dashboard),
      "Dashboard.tsx must render its agent-id / quota lines as machine strings",
    ).toBe(true);
    expect(
      /className\s*=\s*["'`][^"'`]*\bmono\b/.test(kbDetail),
      "KnowledgeBaseDetail.tsx must render its meta line as a machine string",
    ).toBe(true);
  });
});

/* =============================================================================
 * Polish rework R4 — the page subtitle and row metadata were the same grey, so
 * two hierarchy levels read as one. The subtitle is now the second text role
 * and row metadata the dimmer third one. This asserts the RESOLVED values, not
 * the token names: a rename that still collapses the two greys must fail.
 * ============================================================================= */
describe("polish R4 — page subtitle and row metadata are two distinct greys", () => {
  /** The colour a class paints, resolved through var() against the theme. */
  function classColor(theme: ThemeName, className: string): Rgb {
    const declared = String(declarationsFor(className).get("color") ?? "");
    expect(declared, `.${className} must declare a colour`).not.toBe("");
    const resolved = expandVars(theme, declared);
    const parsed = parseColor(resolved);
    if (!parsed) {
      throw new Error(
        `.${className} colour is not a colour (${theme}): "${resolved}"`,
      );
    }
    return parsed;
  }

  /** Two colours are the same ink at a 1/255 tolerance per channel. */
  function sameInk(a: Rgb, b: Rgb): boolean {
    const channel = (x: number, y: number) => Math.abs(x - y) < 1 / 255;
    return channel(a.r, b.r) && channel(a.g, b.g) && channel(a.b, b.b);
  }

  it("the page subtitle paints in --color-text-secondary in both themes", () => {
    for (const theme of THEMES) {
      const declared = declarationsFor("page-subtitle").get("color");
      expect(
        String(declared),
        `.page-subtitle must use the second text role (${theme})`,
      ).toBe("var(--color-text-secondary)");
      expect(
        sameInk(
          classColor(theme, "page-subtitle"),
          colorOf(theme, "--color-text-secondary"),
        ),
        `.page-subtitle must resolve to --color-text-secondary (${theme})`,
      ).toBe(true);
    }
  });

  it("row metadata and description paint in the dimmer third role in both themes", () => {
    for (const theme of THEMES) {
      const dim = colorOf(theme, "--color-text-tertiary");
      for (const className of ["list-row-meta", "list-cell", "list-row-description"]) {
        expect(
          sameInk(classColor(theme, className), dim),
          `.${className} must resolve to the dim row-metadata role (${theme})`,
        ).toBe(true);
      }
    }
  });

  it("the two roles resolve to DIFFERENT computed colours in BOTH themes", () => {
    for (const theme of THEMES) {
      const subtitle = classColor(theme, "page-subtitle");
      const meta = classColor(theme, "list-row-meta");

      // A computed comparison, not a string match: the two greys must actually
      // differ once var() is resolved against the theme.
      expect(
        sameInk(subtitle, meta),
        `the page subtitle and row metadata must not be the same colour (${theme})`,
      ).toBe(false);

      // ...and the subtitle must be the LIGHTER ink of the two (or, in light
      // theme, the darker one): it is the higher hierarchy level on its own
      // surface, so it must out-contrast the row metadata.
      const subtitleContrast = ratio(
        theme,
        "--color-text-secondary",
        "--color-bg-secondary",
      );
      const metaContrast = ratio(
        theme,
        "--color-text-tertiary",
        "--color-bg-secondary",
      );
      expect(
        subtitleContrast,
        `the subtitle must out-contrast row metadata (${theme}): ${subtitleContrast} vs ${metaContrast}`,
      ).toBeGreaterThan(metaContrast);
    }
  });
});

/* =============================================================================
 * Craft wave B (lane CRAFT) — spec R6, the interactive layer.
 *
 * The selection surface moved from a solid accent fill to the accent tint
 * (`--color-accent-subtle`, one alias of `--color-surface-selected`), because a
 * solid fill repainted the ink colour of the text under it. That means the pair
 * `text-primary on accent-subtle` is now the pair that has to be legible, in
 * both themes, so it is pinned here rather than left to the eye.
 * ============================================================================= */
describe("craft R6 — the accent tint is a legible selection surface", () => {
  it("::selection paints the tint under the page's own ink, and the pair clears 4.5:1", () => {
    const selection = RULES.find((rule) =>
      rule.selectors.includes("::selection"),
    );
    expect(selection, "::selection must be styled").not.toEqual(undefined);
    const decls = declarationMap((selection as CssRule).declarations);
    expect(String(decls.get("background"))).toBe("var(--color-accent-subtle)");
    expect(String(decls.get("color"))).toBe("var(--fg-strong)");

    for (const theme of THEMES) {
      expect(
        resolveToken(theme, "--color-accent-subtle"),
        "--color-accent-subtle is an alias of the themed accent tint",
      ).toBe(resolveToken(theme, "--color-surface-selected"));
      expect(
        ratio(theme, "--color-text-primary", "--color-surface-selected"),
        `selected text on the accent tint (${theme})`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
