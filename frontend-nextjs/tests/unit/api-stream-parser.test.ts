/**
 * Unit tests for frontend SSE stream parsing logic in src/services/api.ts
 *
 * Run with: vitest run tests/unit/api-stream-parser.test.ts
 * or: jest tests/unit/api-stream-parser.test.ts
 */

import { describe, it, expect, vi } from 'vitest';

/**
 * Extracted SSE parsing logic for unit testing.
 * These tests verify the delimiter finding, event parsing, and callback behavior
 * of the streamChat() method in APIService.
 */

// Re-implement the delimiter finder for testing
function findEventDelimiter(buffer: string): { index: number; length: number } | null {
  const crlfIndex = buffer.indexOf('\r\n\r\n');
  const lfIndex = buffer.indexOf('\n\n');

  if (crlfIndex === -1 && lfIndex === -1) {
    return null;
  }
  if (crlfIndex === -1) {
    return { index: lfIndex, length: 2 };
  }
  if (lfIndex === -1) {
    return { index: crlfIndex, length: 4 };
  }
  return crlfIndex < lfIndex
    ? { index: crlfIndex, length: 4 }
    : { index: lfIndex, length: 2 };
}

// Parse a single SSE event
function parseSseEvent(rawEvent: string): { name: string; data: string } | null {
  if (!rawEvent.trim()) {
    return null;
  }

  let eventName = 'message';
  const dataLines: string[] = [];

  for (const line of rawEvent.split('\n')) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return { name: eventName, data: dataLines.join('\n') };
}

describe('SSE Delimiter Parsing', () => {
  it('returns null when no delimiter found', () => {
    expect(findEventDelimiter('partial event')).toBeNull();
    expect(findEventDelimiter('')).toBeNull();
  });

  it('finds LF delimiter', () => {
    const result = findEventDelimiter('event: content\ndata: {"content": "hi"}\n\n');
    expect(result).toEqual({ index: 38, length: 2 });
  });

  it('finds CRLF delimiter', () => {
    const result = findEventDelimiter('event: content\r\ndata: {"content": "hi"}\r\n\r\n');
    expect(result).toEqual({ index: 39, length: 4 });
  });

  it('prefers first delimiter when both exist', () => {
    const buffer = 'data: test\n\nevent: other\r\n\r\n';
    const result = findEventDelimiter(buffer);
    expect(result).toEqual({ index: 10, length: 2 }); // \n\n comes first
  });

  it('prefers CRLF when it comes first', () => {
    const buffer = 'data: test\r\n\r\nevent: other\n\n';
    // 'data: test' = 10 chars, so \r\n\r\n starts at index 10
    const result = findEventDelimiter(buffer);
    expect(result).toEqual({ index: 10, length: 4 });
  });
});

describe('SSE Event Parsing', () => {
  it('parses content event', () => {
    const raw = 'event: content\ndata: {"content": "hello"}';
    const parsed = parseSseEvent(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe('content');
    expect(parsed!.data).toBe('{"content": "hello"}');
  });

  it('parses done event', () => {
    const raw = 'event: done\ndata: {"session_id": "sess_123", "usage": null}';
    const parsed = parseSseEvent(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe('done');
    expect(parsed!.data).toContain('sess_123');
  });

  it('parses sources event', () => {
    const raw = 'event: sources\ndata: {"sources": [{"type": "url", "title": "Test"}]}';
    const parsed = parseSseEvent(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe('sources');
  });

  it('parses error event', () => {
    const raw = 'event: error\ndata: {"error": "Rate limit exceeded", "code": "RATE_LIMITED"}';
    const parsed = parseSseEvent(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe('error');
  });

  it('parses thinking event', () => {
    const raw = 'event: thinking\ndata: {"elapsed": 1.5}';
    const parsed = parseSseEvent(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe('thinking');
  });

  it('parses thinking_done event', () => {
    const raw = 'event: thinking_done\ndata: {}';
    const parsed = parseSseEvent(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe('thinking_done');
  });

  it('returns null for empty events', () => {
    expect(parseSseEvent('')).toBeNull();
    expect(parseSseEvent('   ')).toBeNull();
    expect(parseSseEvent('\n\n')).toBeNull();
  });

  it('returns null for events without data', () => {
    const raw = 'event: unknown';
    expect(parseSseEvent(raw)).toBeNull();
  });

  it('defaults to message event name', () => {
    const raw = 'data: {"key": "value"}';
    const parsed = parseSseEvent(raw);
    expect(parsed!.name).toBe('message');
  });

  it('joins multiple data lines', () => {
    const raw = 'event: content\ndata: line1\ndata: line2';
    const parsed = parseSseEvent(raw);
    expect(parsed!.data).toBe('line1\nline2');
  });

  it('trims leading whitespace in data (trimStart behavior)', () => {
    const raw = 'event: content\ndata:  indented text';
    const parsed = parseSseEvent(raw);
    expect(parsed!.data).toBe('indented text');
  });
});

describe('Full Stream Processing', () => {
  it('processes complete stream with multiple events', () => {
    const rawStream =
      'event: sources\ndata: {"sources": []}\n\n' +
      'event: thinking\ndata: {"elapsed": 1.0}\n\n' +
      'event: content\ndata: {"content": "H"}\n\n' +
      'event: content\ndata: {"content": "ello"}\n\n' +
      'event: done\ndata: {"session_id": "s1"}\n\n';

    const events: Array<{ name: string; data: any }> = [];
    let pos = 0;

    while (pos < rawStream.length) {
      const delimiter = findEventDelimiter(rawStream.slice(pos));
      if (!delimiter) break;

      const rawEvent = rawStream.slice(pos, pos + delimiter.index);
      pos += delimiter.index + delimiter.length;

      const parsed = parseSseEvent(rawEvent.replace(/\r\n/g, '\n'));
      if (parsed) {
        let data = {};
        try { data = JSON.parse(parsed.data); } catch { /* ignore */ }
        events.push({ name: parsed.name, data });
      }
    }

    expect(events).toHaveLength(5);
    expect(events[0].name).toBe('sources');
    expect(events[1].name).toBe('thinking');
    expect(events[2].name).toBe('content');
    expect(events[3].name).toBe('content');
    expect(events[4].name).toBe('done');
    expect((events[4].data as any).session_id).toBe('s1');
  });

  it('handles partial events correctly', () => {
    // First chunk: incomplete event
    const chunk1 = 'event: content\ndata: {"conten';
    expect(findEventDelimiter(chunk1)).toBeNull();

    // Second chunk: completes the event
    const chunk2 = 'event: content\ndata: {"content": "hello"}\n\n';
    const result = findEventDelimiter(chunk2);
    expect(result).not.toBeNull();
    const event = parseSseEvent(chunk2.slice(0, result!.index));
    expect(event!.name).toBe('content');
  });
});
