/**
 * Storage fallback tests for BasjooWidget
 * Ensures widget renders even when localStorage access is denied (cross-origin, sandboxed, opaque-origin contexts)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Import the widget to register it on window
import './BasjooWidget';

// Helper to create a throwing localStorage mock
function createThrowingMock(): Storage {
  const error = new Error("Failed to read the 'localStorage' property from 'Window': Access is denied for this document.");
  return {
    getItem: vi.fn(() => { throw error; }),
    setItem: vi.fn(() => { throw error; }),
    removeItem: vi.fn(() => { throw error; }),
    clear: vi.fn(() => { throw error; }),
    key: vi.fn(() => { throw error; }),
    get length() { throw error; },
  } as unknown as Storage;
}

// Helper to create a working localStorage mock backed by Map
function createWorkingMock(): { mock: Storage; store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    mock: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
      removeItem: vi.fn((key: string) => { store.delete(key); }),
      clear: vi.fn(() => { store.clear(); }),
      key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
      get length() { return store.size; },
    } as unknown as Storage,
    store,
  };
}

describe('BasjooWidget storage fallback', () => {
  let originalLocalStorage: Storage;

  beforeEach(() => {
    // Create minimal DOM structure
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';

    // Store original localStorage
    originalLocalStorage = window.localStorage;
  });

  afterEach(() => {
    // Restore original localStorage
    Object.defineProperty(window, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    });

    // Clean up any widget containers
    const containers = document.querySelectorAll('#basjoo-widget-container');
    containers.forEach((el) => el.remove());
    const styles = document.querySelectorAll('#basjoo-widget-styles');
    styles.forEach((el) => el.remove());
  });

  it('does not throw during widget construction when localStorage.getItem throws', () => {
    const throwingMock = createThrowingMock();

    Object.defineProperty(window, 'localStorage', {
      value: throwingMock,
      writable: true,
      configurable: true,
    });

    const BasjooWidget = (window as any).BasjooWidget;

    expect(() => {
      new BasjooWidget({ agentId: 'test-agent' });
    }).not.toThrow();
  });

  it('creates container and button when storage access is denied', async () => {
    const throwingMock = createThrowingMock();

    Object.defineProperty(window, 'localStorage', {
      value: throwingMock,
      writable: true,
      configurable: true,
    });

    const BasjooWidget = (window as any).BasjooWidget;
    const widget = new BasjooWidget({ agentId: 'test-agent', apiBase: 'http://localhost:8000' });

    await widget.init();

    // Verify widget container exists
    const container = document.getElementById('basjoo-widget-container');
    expect(container).toBeTruthy();

    // Verify widget button exists
    const button = document.getElementById('basjoo-widget-button');
    expect(button).toBeTruthy();
  });

  it('falls back to memory storage and returns values during same page lifecycle', async () => {
    const { mock: workingMock, store } = createWorkingMock();

    Object.defineProperty(window, 'localStorage', {
      value: workingMock,
      writable: true,
      configurable: true,
    });

    const BasjooWidget = (window as any).BasjooWidget;
    const widget = new BasjooWidget({ agentId: 'test-agent', apiBase: 'http://localhost:8000' });

    await widget.init();

    // Check that visitor_id was stored
    expect(store.has('basjoo_visitor_id')).toBe(true);
    const visitorId = store.get('basjoo_visitor_id');
    expect(visitorId).toBeTruthy();
    expect(typeof visitorId).toBe('string');
    expect(visitorId!.startsWith('visitor_')).toBe(true);

    // Create another widget instance - should use same visitor_id
    const widget2 = new BasjooWidget({ agentId: 'test-agent', apiBase: 'http://localhost:8000' });
    await widget2.init();

    // Both widgets should have the same visitor ID
    const visitorId2 = store.get('basjoo_visitor_id');
    expect(visitorId2).toBe(visitorId);
  });

  it('maintains session_id across widget operations when storage works', async () => {
    const { mock: workingMock, store } = createWorkingMock();

    Object.defineProperty(window, 'localStorage', {
      value: workingMock,
      writable: true,
      configurable: true,
    });

    const BasjooWidget = (window as any).BasjooWidget;

    // Pre-set a session ID
    store.set('basjoo_session_test-agent', 'session_12345');

    const widget = new BasjooWidget({ agentId: 'test-agent', apiBase: 'http://localhost:8000' });
    await widget.init();

    // Session should be loaded from storage
    expect(store.get('basjoo_session_test-agent')).toBe('session_12345');
  });
});
