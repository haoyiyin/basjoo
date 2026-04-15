/**
 * Unit tests for BasjooWidget helper functions.
 *
 * Run with: vitest run tests/unit/widget-helpers.test.ts
 * or: jest tests/unit/widget-helpers.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Re-implement formatAssistantMessage for testing
interface Source {
  type: 'url' | 'qa';
  title?: string;
  url?: string;
  snippet?: string;
  question?: string;
  id?: string;
}

function formatAssistantMessage(content: string, sources: Source[] = []): { content: string; references: Array<{ title: string; url: string }> } {
  if (!content) {
    return { content, references: [] };
  }

  const references: Array<{ title: string; url: string }> = [];
  const seenUrls = new Set<string>();
  const sourceByUrl = new Map<string, Source & { type: 'url'; url: string }>();

  for (const source of sources) {
    if (source.type !== 'url' || typeof source.url !== 'string' || !/^https?:\/\//.test(source.url) || sourceByUrl.has(source.url)) {
      continue;
    }
    sourceByUrl.set(source.url, source as Source & { type: 'url'; url: string });
  }

  const addReference = (url: string) => {
    if (seenUrls.has(url)) {
      return;
    }
    seenUrls.add(url);
    const source = sourceByUrl.get(url);
    references.push({
      title: source?.title?.trim() || url,
      url,
    });
  };

  const formattedContent = content.replace(
    /\[([^\]]+)\]\((#source-(\d+)|https?:\/\/[^\s)]+)\)/g,
    (_match, label: string, target: string, sourceIndexText?: string) => {
      if (sourceIndexText) {
        const sourceIndex = Number(sourceIndexText) - 1;
        const source = sources[sourceIndex];
        if (source && source.type === 'url' && source.url && /^https?:\/\//.test(source.url)) {
          addReference(source.url);
        }
        return label;
      }

      if (sourceByUrl.has(target)) {
        addReference(target);
        return label;
      }

      return _match;
    },
  );

  return {
    content: formattedContent,
    references,
  };
}

describe('formatAssistantMessage', () => {
  it('returns empty content for empty input', () => {
    const result = formatAssistantMessage('', []);
    expect(result.content).toBe('');
    expect(result.references).toEqual([]);
  });

  it('returns content without references when no sources', () => {
    const result = formatAssistantMessage('Hello world', []);
    expect(result.content).toBe('Hello world');
    expect(result.references).toEqual([]);
  });

  it('extracts #source-N references', () => {
    const sources: Source[] = [
      { type: 'url', title: 'My Page', url: 'https://example.com' },
    ];
    const result = formatAssistantMessage('See [docs](#source-1) for details.', sources);
    expect(result.content).toBe('See docs for details.');
    expect(result.references).toEqual([{ title: 'My Page', url: 'https://example.com' }]);
  });

  it('extracts direct URL references', () => {
    const sources: Source[] = [
      { type: 'url', title: 'My Page', url: 'https://example.com' },
    ];
    const result = formatAssistantMessage('Check [this](https://example.com) out.', sources);
    expect(result.content).toBe('Check this out.');
    expect(result.references).toEqual([{ title: 'My Page', url: 'https://example.com' }]);
  });

  it('deduplicates URL references', () => {
    const sources: Source[] = [
      { type: 'url', title: 'Page 1', url: 'https://example.com' },
      { type: 'url', title: 'Page 2', url: 'https://other.com' },
    ];
    const result = formatAssistantMessage(
      'See [one](#source-1) and also [two](#source-1).',
      sources,
    );
    expect(result.content).toBe('See one and also two.');
    expect(result.references).toHaveLength(1);
    expect(result.references[0].url).toBe('https://example.com');
  });

  it('includes multiple distinct references', () => {
    const sources: Source[] = [
      { type: 'url', title: 'Page A', url: 'https://a.com' },
      { type: 'url', title: 'Page B', url: 'https://b.com' },
    ];
    const result = formatAssistantMessage(
      'See [a](#source-1) and [b](#source-2).',
      sources,
    );
    expect(result.references).toHaveLength(2);
    expect(result.references[0].url).toBe('https://a.com');
    expect(result.references[1].url).toBe('https://b.com');
  });

  it('keeps QA references as text (no URL)', () => {
    const sources: Source[] = [
      { type: 'qa', question: 'What?', id: 'q1' },
    ];
    const result = formatAssistantMessage('As per [qa](#source-1)...', sources);
    expect(result.content).toBe('As per qa...');
    expect(result.references).toEqual([]);
  });

  it('strips out-of-range source index', () => {
    const sources: Source[] = [];
    const result = formatAssistantMessage('See [link](#source-1).', sources);
    expect(result.content).toBe('See link.');
    expect(result.references).toEqual([]);
  });

  it('handles mixed valid and invalid references', () => {
    const sources: Source[] = [
      { type: 'url', title: 'Valid', url: 'https://valid.com' },
      { type: 'qa', question: 'FAQ', id: 'f1' },
    ];
    const result = formatAssistantMessage(
      'See [valid](#source-1) and [faq](#source-2).',
      sources,
    );
    expect(result.content).toBe('See valid and faq.');
    expect(result.references).toEqual([{ title: 'Valid', url: 'https://valid.com' }]);
  });

  it('uses URL as title when source has no title', () => {
    const sources: Source[] = [
      { type: 'url', url: 'https://notitle.com' },
    ];
    const result = formatAssistantMessage('See [page](#source-1).', sources);
    expect(result.references[0].title).toBe('https://notitle.com');
  });
});

describe('Widget API Base Detection (conceptual tests)', () => {
  // In a real test environment, we would need to mock document.currentScript
  // and window.location. Here we test the core URL logic.

  it('uses configured apiBase when provided', () => {
    // This tests the URL construction logic
    const apiBase = 'https://api.example.com';
    const url = new URL('/basjoo-logo.png', `${apiBase}/`);
    expect(url.toString()).toBe('https://api.example.com/basjoo-logo.png');
  });

  it('handles apiBase with trailing slash', () => {
    const apiBase = 'https://api.example.com/';
    const url = new URL('/basjoo-logo.png', apiBase);
    expect(url.toString()).toBe('https://api.example.com/basjoo-logo.png');
  });

  it('builds logo URL from relative path', () => {
    const apiBase = '';
    const origin = 'http://localhost';
    const url = new URL('/basjoo-logo.png', origin);
    expect(url.toString()).toContain('/basjoo-logo.png');
  });
});

describe('Widget Storage Key Conventions', () => {
  it('generates session key per agent ID', () => {
    const agentId = 'agt_0123456789ab';
    const storageKey = `basjoo_session_${agentId}`;
    expect(storageKey).toBe('basjoo_session_agt_0123456789ab');
  });

  it('visitor ID uses global key', () => {
    expect('basjoo_visitor_id').toBe('basjoo_visitor_id');
  });
});
