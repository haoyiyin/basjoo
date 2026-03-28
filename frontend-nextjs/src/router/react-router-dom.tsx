'use client';

import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import { useEffect, useMemo } from 'react';
import NextLink from 'next/link';
import { usePathname, useRouter, useSearchParams as useNextSearchParams, useParams as useNextParams } from 'next/navigation';

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
  const searchParams = useNextSearchParams();
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
  const searchParams = useNextSearchParams();
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

export { useParamsTyped as useParams, useSearchParamsState as useSearchParams };
