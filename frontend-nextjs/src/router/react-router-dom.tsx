'use client';

import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo } from 'react';
import { Suspense } from 'react';
import NextLink from 'next/link';
import { usePathname, useRouter, useSearchParams as useNextSearchParams, useParams as useNextParams } from 'next/navigation';

interface SearchParamsContextValue {
  searchParams: URLSearchParams;
}

const SearchParamsContext = createContext<SearchParamsContextValue | null>(null);

/**
 * Provides search params to all router shim hooks via a Suspense boundary.
 * Wrap this around any route group layout that uses useLocation or useSearchParams.
 */
function SearchParamsProvider({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<SearchParamsProviderFallback>{children}</SearchParamsProviderFallback>}>
      <SearchParamsProviderInner>{children}</SearchParamsProviderInner>
    </Suspense>
  );
}

function SearchParamsProviderInner({ children }: { children: ReactNode }) {
  const nextParams = useNextSearchParams();
  const value = useMemo<SearchParamsContextValue>(() => ({ searchParams: nextParams }), [nextParams]);
  return <SearchParamsContext.Provider value={value}>{children}</SearchParamsContext.Provider>;
}

function SearchParamsProviderFallback({ children }: { children: ReactNode }) {
  const fallback = useMemo<SearchParamsContextValue>(() => ({ searchParams: new URLSearchParams() }), []);
  return <SearchParamsContext.Provider value={fallback}>{children}</SearchParamsContext.Provider>;
}

function getSearchParams(): URLSearchParams {
  const ctx = useContext(SearchParamsContext);
  return ctx?.searchParams ?? new URLSearchParams();
}

interface NavigateProps {
  to: string;
  replace?: boolean;
}

function buildSearchParams(searchParams: URLSearchParams | { toString(): string }) {
  return new URLSearchParams(searchParams.toString());
}

export function useNavigate() {
  const router = useRouter();
  return (to: string, options?: { replace?: boolean }) => {
    if (options?.replace) {
      router.replace(to);
      return;
    }
    router.push(to);
  };
}

export function useLocation() {
  const pathname = usePathname();
  const searchParams = getSearchParams();
  const search = searchParams?.toString() || '';

  return useMemo(() => ({
    pathname,
    search: search ? `?${search}` : '',
  }), [pathname, search]);
}

export function useParamsTyped<T extends Record<string, string>>() {
  return useNextParams() as T;
}

export function useSearchParamsState() {
  const searchParams = getSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const safePathname = pathname || '/';

  const setSearchParams = (next: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams)) => {
    const prev = buildSearchParams(searchParams || new URLSearchParams());
    const resolved = typeof next === 'function' ? next(prev) : next;
    const query = resolved.toString();
    router.replace(query ? `${safePathname}?${query}` : safePathname);
  };

  return [searchParams, setSearchParams] as const;
}

export function Navigate({ to, replace }: NavigateProps) {
  const router = useRouter();

  useEffect(() => {
    if (replace) {
      router.replace(to);
    } else {
      router.push(to);
    }
  }, [replace, router, to]);

  return null;
}

export interface LinkProps {
  to: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}

export function Link({ to, children, className, style, onClick }: LinkProps) {
  return (
    <NextLink href={to} className={className} style={style} onClick={onClick}>
      {children}
    </NextLink>
  );
}

export function BrowserRouter({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function Routes({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function Route() {
  return null;
}

export { useParamsTyped as useParams, useSearchParamsState as useSearchParams, SearchParamsProvider };
