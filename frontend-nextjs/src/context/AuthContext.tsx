"use client";

import {
	createContext,
	useContext,
	useState,
	useEffect,
	useCallback,
	ReactNode,
} from "react";
import { API_BASE_URL } from "../lib/env";
import { parseErrorResponse } from "../services/api";

interface Admin {
	id: number;
	email: string;
	name: string;
	role: string;
}

interface AuthContextType {
	admin: Admin | null;
	token: string | null;
	login: (email: string, password: string) => Promise<void>;
	logout: () => void;
	register: (email: string, password: string, name: string) => Promise<void>;
	isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const TOKEN_STORAGE_KEY = "token";
const ADMIN_STORAGE_KEY = "admin";

interface LoginResponseData {
	access_token: string;
	admin: Admin;
}

/** All expected JWT claims plus room for extras from the backend. */
export interface JwtPayload {
	exp?: number;
	sub?: string;
	[key: string]: unknown;
}

export function parseJwtPayload(token: string): JwtPayload | null {
	try {
		const parts = token.split(".");
		if (parts.length < 2) {
			return null;
		}
		const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
		return JSON.parse(window.atob(padded)) as JwtPayload;
	} catch {
		return null;
	}
}

function isTokenExpired(token: string): boolean {
	const payload = parseJwtPayload(token);
	if (!payload?.exp) {
		return false;
	}
	return payload.exp * 1000 <= Date.now();
}

export function AuthProvider({ children }: { children: ReactNode }) {
	const [admin, setAdmin] = useState<Admin | null>(null);
	const [token, setToken] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);

	const persistSession = useCallback((data: LoginResponseData) => {
		setToken(data.access_token);
		setAdmin(data.admin);
		localStorage.setItem(TOKEN_STORAGE_KEY, data.access_token);
		localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(data.admin));
	}, []);

	const logout = useCallback(() => {
		setToken(null);
		setAdmin(null);
		localStorage.removeItem(TOKEN_STORAGE_KEY);
		localStorage.removeItem(ADMIN_STORAGE_KEY);
	}, []);

	useEffect(() => {
		const savedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
		const savedAdmin = localStorage.getItem(ADMIN_STORAGE_KEY);

		if (savedToken && savedAdmin && !isTokenExpired(savedToken)) {
			try {
				setToken(savedToken);
				setAdmin(JSON.parse(savedAdmin));
			} catch {
				localStorage.removeItem(TOKEN_STORAGE_KEY);
				localStorage.removeItem(ADMIN_STORAGE_KEY);
			}
		} else {
			localStorage.removeItem(TOKEN_STORAGE_KEY);
			localStorage.removeItem(ADMIN_STORAGE_KEY);
		}

		setIsLoading(false);
	}, []);

	// Refresh admin role from the backend on mount so that role changes
	// (e.g. readonly → support migration, role downgrade) are reflected
	// without requiring a re-login.
	useEffect(() => {
		if (!token || isTokenExpired(token)) {
			return;
		}

		let cancelled = false;

		const refresh = async () => {
			try {
				const response = await fetch(`${API_BASE_URL}/api/admin/me`, {
					headers: { Authorization: `Bearer ${token}` },
				});
				if (!response.ok) {
					// Token invalid or user deactivated — clear auth state.
					logout();
					return;
				}
				const data = await response.json();
				if (!cancelled) {
					const updated = {
						id: data.id,
						email: data.email,
						name: data.name,
						role: data.role,
					};
					setAdmin(updated);
					localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(updated));
				}
			} catch {
				// Network error — keep existing cached admin, don't log out.
			}
		};

		refresh();
		return () => {
			cancelled = true;
		};
	}, [token, logout]);

	useEffect(() => {
		if (!token) {
			return;
		}

		const payload = parseJwtPayload(token);
		if (!payload?.exp) {
			return;
		}

		const expiresAt = payload.exp * 1000;
		const delay = expiresAt - Date.now();
		if (delay <= 0) {
			logout();
			return;
		}

		const timer = window.setTimeout(() => {
			logout();
		}, delay);

		return () => {
			window.clearTimeout(timer);
		};
	}, [logout, token]);

	const login = async (email: string, password: string) => {
		const response = await fetch(`${API_BASE_URL}/api/admin/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, password }),
		});

		if (!response.ok) {
			const message = await parseErrorResponse(response);
			throw new Error(message || "登录失败");
		}

		const data = await response.json();

		persistSession(data);
	};

	const register = async (email: string, password: string, name: string) => {
		const response = await fetch(`${API_BASE_URL}/api/admin/register`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, password, name }),
		});

		if (!response.ok) {
			const message = await parseErrorResponse(response);
			throw new Error(message || "注册失败");
		}

		const data = await response.json();
		if (data.access_token && data.admin) {
			persistSession(data);
			return;
		}

		await login(email, password);
	};

	return (
		<AuthContext.Provider
			value={{ admin, token, login, logout, register, isLoading }}
		>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const context = useContext(AuthContext);
	if (context === undefined) {
		throw new Error("useAuth must be used within an AuthProvider");
	}
	return context;
}
