'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Top-level crash barrier.
 *
 * Mounted ABOVE I18nextProvider in `AppProviders.tsx`, so this file must never
 * call `useTranslation()` (there is no i18n context yet when it renders). The
 * copy below is therefore a fixed English fallback by design, not an i18n
 * omission.
 *
 * Restyle (spec §20): the Tailwind-ish utility classes are gone; the fallback
 * is built from the design-system primitives (`page` / `empty` / `card` /
 * `btn btn-primary`). Behaviour (getDerivedStateFromError, componentDidCatch,
 * handleReset) is untouched.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = '/';
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="page" role="alert">
          <div className="empty">
            <h1 className="empty-title">Something went wrong</h1>
            <p className="empty-description">
              An unexpected error occurred. Please try refreshing the page.
            </p>
            {this.state.error && (
              <details
                className="card"
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: 'var(--space-4)',
                  boxShadow: 'none',
                }}
              >
                <summary
                  className="caption"
                  style={{
                    cursor: 'pointer',
                    color: 'var(--fg-default)',
                    marginBottom: 'var(--space-2)',
                  }}
                >
                  Error Details
                </summary>
                <pre
                  style={{
                    marginTop: 'var(--space-2)',
                    maxHeight: '240px',
                    overflow: 'auto',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--fg-dim)',
                  }}
                >
                  {this.state.error.toString()}
                </pre>
                {this.state.errorInfo && (
                  <pre
                    style={{
                      marginTop: 'var(--space-2)',
                      maxHeight: '240px',
                      overflow: 'auto',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--fg-dim)',
                    }}
                  >
                    {this.state.errorInfo.componentStack}
                  </pre>
                )}
              </details>
            )}
            <div className="empty-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={this.handleReset}
              >
                Return to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
