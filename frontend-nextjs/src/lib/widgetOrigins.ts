/**
 * Widget origin parsing and validation helpers.
 *
 * Used by AgentSettings to parse and validate allowed_widget_origins input.
 * Behavior mirrors backend normalization in backend/api/v1/schemas.py::normalize_widget_origin.
 */

export interface WidgetOriginValidationResult {
  normalizedOrigins: string[];
  invalidOrigins: string[];
}

/**
 * Parse a multiline/comma-separated string into individual origin entries.
 * Splits on newlines or commas, trims whitespace, and filters empty entries.
 */
export function parseAllowedWidgetOriginsText(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Validate and normalize widget origins.
 *
 * - Splits input by newline or comma
 * - Requires http: or https: protocol
 * - Rejects URLs with credentials (username/password)
 * - Normalizes to lowercase origin (protocol + host)
 * - Strips path, query, and fragment
 * - Deduplicates after normalization
 *
 * Returns normalized valid origins and list of invalid entries.
 */
export function validateAllowedWidgetOriginsText(
  value: string,
): WidgetOriginValidationResult {
  const normalizedOrigins: string[] = [];
  const invalidOrigins: string[] = [];
  const seenOrigins = new Set<string>();

  for (const origin of parseAllowedWidgetOriginsText(value)) {
    try {
      const url = new URL(origin);
      const protocol = url.protocol.toLowerCase();
      if (
        (protocol !== 'http:' && protocol !== 'https:') ||
        !url.host ||
        url.username ||
        url.password
      ) {
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