/**
 * Unit tests for SystemSettings allowed_widget_origins parsing and validation.
 *
 * Run with: vitest run tests/unit/system-settings-origin-parser.test.ts
 */

import { describe, it, expect } from 'vitest';

/**
 * Extracted from SystemSettings.tsx
 */
function parseAllowedWidgetOriginsText(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map(origin => origin.trim())
    .filter(Boolean);
}

function validateAllowedWidgetOriginsText(value: string): {
  normalizedOrigins: string[];
  invalidOrigins: string[];
} {
  const normalizedOrigins: string[] = [];
  const invalidOrigins: string[] = [];
  const seenOrigins = new Set<string>();

  for (const origin of parseAllowedWidgetOriginsText(value)) {
    try {
      const url = new URL(origin);
      const protocol = url.protocol.toLowerCase();
      if ((protocol !== 'http:' && protocol !== 'https:') || !url.host || url.username || url.password) {
        invalidOrigins.push(origin);
        continue;
      }

      const normalizedOrigin = `${protocol}//${url.host.toLowerCase()}`;
      if (!seenOrigins.has(normalizedOrigin)) {
        seenOrigins.add(normalizedOrigin);
        normalizedOrigins.push(normalizedOrigin);
      }
    } catch {
      invalidOrigins.push(origin);
    }
  }

  return { normalizedOrigins, invalidOrigins };
}

describe('parseAllowedWidgetOriginsText', () => {
  it('splits by newlines', () => {
    const result = parseAllowedWidgetOriginsText('https://a.com\nhttps://b.com');
    expect(result).toEqual(['https://a.com', 'https://b.com']);
  });

  it('splits by commas', () => {
    const result = parseAllowedWidgetOriginsText('https://a.com,https://b.com');
    expect(result).toEqual(['https://a.com', 'https://b.com']);
  });

  it('handles mixed newlines and commas', () => {
    const result = parseAllowedWidgetOriginsText('https://a.com,https://b.com\nhttps://c.com');
    expect(result).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
  });

  it('strips whitespace', () => {
    const result = parseAllowedWidgetOriginsText('  https://a.com  ,  https://b.com  ');
    expect(result).toEqual(['https://a.com', 'https://b.com']);
  });

  it('filters empty entries', () => {
    const result = parseAllowedWidgetOriginsText('https://a.com,,\n\nhttps://b.com');
    expect(result).toEqual(['https://a.com', 'https://b.com']);
  });

  it('returns empty array for empty input', () => {
    expect(parseAllowedWidgetOriginsText('')).toEqual([]);
    expect(parseAllowedWidgetOriginsText('   ')).toEqual([]);
    expect(parseAllowedWidgetOriginsText('\n\n')).toEqual([]);
  });
});

describe('validateAllowedWidgetOriginsText', () => {
  it('accepts valid HTTP origins', () => {
    const result = validateAllowedWidgetOriginsText('http://localhost:3000');
    expect(result.normalizedOrigins).toEqual(['http://localhost:3000']);
    expect(result.invalidOrigins).toEqual([]);
  });

  it('accepts valid HTTPS origins', () => {
    const result = validateAllowedWidgetOriginsText('https://example.com');
    expect(result.normalizedOrigins).toEqual(['https://example.com']);
    expect(result.invalidOrigins).toEqual([]);
  });

  it('normalizes to lowercase', () => {
    const result = validateAllowedWidgetOriginsText('HTTPS://EXAMPLE.COM');
    expect(result.normalizedOrigins).toEqual(['https://example.com']);
  });

  it('strips path from origin', () => {
    const result = validateAllowedWidgetOriginsText('https://example.com/path/page');
    expect(result.normalizedOrigins).toEqual(['https://example.com']);
  });

  it('rejects origins without scheme', () => {
    const result = validateAllowedWidgetOriginsText('example.com');
    expect(result.normalizedOrigins).toEqual([]);
    expect(result.invalidOrigins).toEqual(['example.com']);
  });

  it('rejects ftp origins', () => {
    const result = validateAllowedWidgetOriginsText('ftp://example.com');
    expect(result.normalizedOrigins).toEqual([]);
    expect(result.invalidOrigins).toEqual(['ftp://example.com']);
  });

  it('rejects origins with credentials', () => {
    const result = validateAllowedWidgetOriginsText('https://user:pass@example.com');
    expect(result.normalizedOrigins).toEqual([]);
    expect(result.invalidOrigins).toEqual(['https://user:pass@example.com']);
  });

  it('deduplicates origins', () => {
    const result = validateAllowedWidgetOriginsText('https://example.com\nhttps://example.com');
    expect(result.normalizedOrigins).toEqual(['https://example.com']);
  });

  it('deduplicates after normalization', () => {
    const result = validateAllowedWidgetOriginsText('https://Example.COM\nHTTPS://example.com');
    expect(result.normalizedOrigins).toEqual(['https://example.com']);
  });

  it('handles mixed valid and invalid', () => {
    const result = validateAllowedWidgetOriginsText('https://a.com\ninvalid\nhttps://b.com');
    expect(result.normalizedOrigins).toEqual(['https://a.com', 'https://b.com']);
    expect(result.invalidOrigins).toEqual(['invalid']);
  });

  it('handles empty input', () => {
    const result = validateAllowedWidgetOriginsText('');
    expect(result.normalizedOrigins).toEqual([]);
    expect(result.invalidOrigins).toEqual([]);
  });
});
