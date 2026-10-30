import { describe, expect, it } from 'vitest';
import {
  buildWidgetEmbedCode,
  isLoopbackOrigin,
  resolveWidgetScriptBaseUrl,
} from '../../src/lib/widgetEmbedCode';

describe('resolveWidgetScriptBaseUrl', () => {
  it('uses the server-reported origin verbatim', () => {
    expect(resolveWidgetScriptBaseUrl('https://api.example.com/')).toBe(
      'https://api.example.com',
    );
  });

  it('never falls back to window.location — an empty answer stays empty', () => {
    // The whole point of #40: a localhost dashboard must not mint a localhost
    // snippet. There is no browser fallback in this function at all, so the
    // caller sees `''` and shows the "unknown origin" state instead.
    expect(resolveWidgetScriptBaseUrl('')).toBe('');
    expect(resolveWidgetScriptBaseUrl(null)).toBe('');
    expect(resolveWidgetScriptBaseUrl(undefined)).toBe('');
  });

  it('rejects anything that is not an http(s) origin', () => {
    expect(resolveWidgetScriptBaseUrl('javascript:alert(1)')).toBe('');
    expect(resolveWidgetScriptBaseUrl('example.com')).toBe('');
  });
});

describe('buildWidgetEmbedCode', () => {
  it('is a single script tag pointing at the server-rendered loader', () => {
    const snippet = buildWidgetEmbedCode('agt_1', 'https://api.example.com');
    expect(snippet).toBe(
      '<script src="https://api.example.com/api/v1/agents/agt_1/embed.js" async></script>',
    );
    // One tag, and nothing inline beside it.
    expect(snippet.match(/<script/g)).toHaveLength(1);
    expect(snippet).not.toContain('<script>');
  });

  it('uses the SERVER origin even when the dashboard runs on localhost', () => {
    // The regression #40 exists for: window.location.origin is localhost here.
    Object.defineProperty(window, 'location', {
      value: { origin: 'http://localhost:3000' },
      writable: true,
      configurable: true,
    });

    const snippet = buildWidgetEmbedCode('agt_1', 'https://shop.example.com');
    expect(snippet).toContain('https://shop.example.com');
    expect(snippet).not.toContain('localhost');
  });

  it('encodes the agent id and carries no query string', () => {
    expect(buildWidgetEmbedCode('agt 1', 'https://api.example.com')).toBe(
      '<script src="https://api.example.com/api/v1/agents/agt%201/embed.js" async></script>',
    );
  });

  it('yields nothing until the server origin is known', () => {
    expect(buildWidgetEmbedCode('agt_1', null)).toBe('');
  });
});

describe('isLoopbackOrigin', () => {
  it('recognises the addresses a proxy-less self-hosted install answers with', () => {
    expect(isLoopbackOrigin('http://127.0.0.1:8000')).toBe(true);
    expect(isLoopbackOrigin('http://localhost:3000')).toBe(true);
    expect(isLoopbackOrigin('https://localhost/')).toBe(true);
    expect(isLoopbackOrigin('http://[::1]:8000')).toBe(true);
    // 127.0.0.0/8 is loopback as a whole.
    expect(isLoopbackOrigin('http://127.9.9.9:8000')).toBe(true);
  });

  it('is false for a public host, so the console stays quiet', () => {
    expect(isLoopbackOrigin('https://shop.example.com')).toBe(false);
    // A name that merely contains localhost is public.
    expect(isLoopbackOrigin('https://localhost.example.com')).toBe(false);
  });

  it('is false for an unknown origin — nothing to warn about', () => {
    expect(isLoopbackOrigin(null)).toBe(false);
    expect(isLoopbackOrigin('')).toBe(false);
    expect(isLoopbackOrigin('not a url')).toBe(false);
  });
});
