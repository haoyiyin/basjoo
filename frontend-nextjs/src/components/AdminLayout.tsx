"use client";

import { ReactNode, useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTranslation } from "react-i18next";
import { api } from "../services/api";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

import { useIsMobile } from "../hooks/useMediaQuery";

interface AdminLayoutProps {
	children: ReactNode;
}

interface NavItem {
	path: string;
	i18nKey: string;
	icon: IconName;
}

/**
 * Workspace (root) navigation — spec §13: exactly these four entries, in this
 * order. 会话 `/sessions` and 用户 `/users` are gone: both routes were deleted
 * from `App.tsx` (`AdminUsers` is gone with them).
 */
const workspaceNavItems: NavItem[] = [
	{ path: "/", i18nKey: "navigation.home", icon: "home" },
	{ path: "/agents", i18nKey: "navigation.agents", icon: "agents" },
	{
		path: "/knowledge-bases",
		i18nKey: "navigation.knowledgeBases",
		icon: "knowledge",
	},
	{
		path: "/settings/account",
		i18nKey: "navigation.accountSettings",
		icon: "settings",
	},
];

/**
 * Agent-scoped navigation — exactly four entries. `/agents/:id/dashboard`
 * replaces the workspace home. The old 知识库 sidebar door (which pointed at
 * `/agents/:id/knowledge`) is gone: the dashboard's knowledge row links to the
 * KB, so the sidebar entry was a second door to the same place. The route
 * itself still resolves (deep link / legacy `/urls`+`/files` redirects).
 */
function agentNavItems(agentBasePath: string): NavItem[] {
	return [
		{
			path: `${agentBasePath}/dashboard`,
			i18nKey: "navigation.dashboard",
			icon: "dashboard",
		},
		{
			path: `${agentBasePath}/playground`,
			i18nKey: "navigation.playground",
			icon: "playground",
		},
		{
			path: `${agentBasePath}/sessions`,
			i18nKey: "navigation.sessions",
			icon: "sessions",
		},
		{
			path: `${agentBasePath}/settings/agent`,
			i18nKey: "navigation.agentSettings",
			icon: "settings",
		},
	];
}

export default function AdminLayout({ children }: AdminLayoutProps) {
	const { t } = useTranslation("common");
	const location = useLocation();
	const navigate = useNavigate();
	const { agentId } = useParams<{ agentId?: string }>();
	const { admin, logout } = useAuth();
	const isMobile = useIsMobile();
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [agentName, setAgentName] = useState<string | null>(null);
	const isSuperAdmin = admin?.role === "super_admin";
	const isSupport = admin?.role === "support";
	const agentBasePath = agentId ? `/agents/${agentId}` : "";

	// Build nav items based on role and context. A `super_admin` at workspace
	// level sees the four §13 entries; every other root role sees none. Support
	// users only ever get the agent-scoped sessions entry.
	const navItems: NavItem[] = agentId
		? agentNavItems(agentBasePath)
		: isSuperAdmin
			? workspaceNavItems
			: []; // Non-super users at root level should redirect, show no nav

	const allowedNav =
		isSupport && agentId
			? navItems.filter(
					(item) => item.path === `${agentBasePath}/sessions`,
				)
			: navItems;

	const scopedNavItems = allowedNav.map((item) => ({
		...item,
		label: t(item.i18nKey),
	}));

	const isActive = (item: NavItem) => {
		if (item.path === location.pathname) return true;
		// Detail routes (`/knowledge-bases/:kbId`) keep their list entry active.
		if (item.path !== "/" && location.pathname.startsWith(`${item.path}/`)) {
			return true;
		}
		return false;
	};

	const handleLogout = () => {
		logout();
		navigate("/login");
	};

	const handleNavClick = () => {
		if (isMobile) {
			setSidebarOpen(false);
		}
	};

	const handleLogoClick = () => {
		if (isMobile) {
			setSidebarOpen(false);
		}
	};

	// Active-item indicator tracking (the floating marker behind the current
	// row). Kept from the previous shell: it follows `data-nav-active`.
	const navRef = useRef<HTMLDivElement>(null);
	const [indicatorStyle, setIndicatorStyle] = useState<{
		top: number;
		height: number;
	}>({ top: 0, height: 0 });

	const updateIndicator = useCallback(() => {
		if (!navRef.current) return;
		const activeEl = navRef.current.querySelector(
			'[data-nav-active="true"]',
		) as HTMLElement | null;
		if (activeEl) {
			const navRect = navRef.current.getBoundingClientRect();
			const elRect = activeEl.getBoundingClientRect();
			setIndicatorStyle({
				top: elRect.top - navRect.top,
				height: elRect.height,
			});
		}
	}, []);

	useEffect(() => {
		updateIndicator();
	}, [location.pathname, updateIndicator]);

	useEffect(() => {
		if (!agentId) {
			setAgentName(null);
			return;
		}

		let cancelled = false;
		setAgentName(null);

		api
			.getAgent(agentId)
			.then((agent) => {
				if (!cancelled) {
					setAgentName(agent.name);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setAgentName(null);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [agentId]);

	const brandPath = isSuperAdmin
		? "/"
		: agentId
			? isSupport
				? `${agentBasePath}/sessions`
				: `${agentBasePath}/dashboard`
			: "/agent-selector";

	const SidebarContent = () => (
		<>
			{/* Brand: workspace name, or the current agent's name in agent scope */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: "var(--space-3)",
					minWidth: 0,
				}}
			>
				<Link
					to={brandPath}
					onClick={handleLogoClick}
					style={{
						textDecoration: "none",
						display: "flex",
						alignItems: "center",
						gap: "var(--space-3)",
						minWidth: 0,
					}}
				>
					<span
						style={{
							width: 36,
							height: 36,
							flexShrink: 0,
							borderRadius: "var(--radius-md)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							overflow: "hidden",
							background: "var(--color-bg-tertiary)",
							border: "1px solid var(--color-border)",
						}}
					>
						<img
							src="/logo.png"
							alt="Basjoo Logo"
							style={{
								width: "100%",
								height: "100%",
								objectFit: "contain",
							}}
						/>
					</span>
					<span style={{ display: "grid", minWidth: 0 }}>
						<h1
							data-testid="sidebar-brand-title"
							style={{
								fontFamily: "var(--font-display)",
								fontSize: "var(--text-lg)",
								fontWeight: 600,
								lineHeight: "var(--leading-tight)",
								letterSpacing: "-0.01em",
								color: "var(--fg-strong)",
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								margin: 0,
							}}
						>
							{agentId ? agentName || t("status.loading") : t("appName")}
						</h1>
						<span
							style={{
								fontSize: "var(--text-xs)",
								lineHeight: "var(--leading-snug)",
								color: "var(--fg-dim)",
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{t("tagline")}
						</span>
					</span>
				</Link>
			</div>

			{agentId && (
				<Link
					to="/"
					onClick={handleLogoClick}
					className="btn btn-ghost"
					style={{
						justifyContent: "flex-start",
						width: "100%",
						textDecoration: "none",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					← {t("agents.panelTitle")}
				</Link>
			)}

			{/* Navigation */}
			<nav
				aria-label={t("navigation.mainNav")}
				style={{
					flex: 1,
					minHeight: 0,
					overflowY: "auto",
				}}
			>
				<div
					ref={navRef}
					style={{
						position: "relative",
						display: "flex",
						flexDirection: "column",
					}}
				>
					{/* Active-item marker (accent tint behind the current row) */}
					{indicatorStyle.height > 0 && (
						<div
							aria-hidden="true"
							style={{
								position: "absolute",
								left: 0,
								right: 0,
								top: `${indicatorStyle.top}px`,
								height: `${indicatorStyle.height}px`,
								background: "var(--color-surface-selected)",
								borderRadius: "var(--radius-md)",
								transition:
									"top var(--transition-base), height var(--transition-base)",
								pointerEvents: "none",
								zIndex: 0,
							}}
						/>
					)}

					<ul
						className="list"
						style={{
							background: "transparent",
							border: "none",
							borderRadius: 0,
							gap: "var(--space-1)",
						}}
					>
						{scopedNavItems.map((item) => {
							const active = isActive(item);

							return (
								<li
									key={item.path}
									style={{ position: "relative", zIndex: 1 }}
								>
									<Link
										to={item.path}
										className="list-row"
										data-nav-active={active ? "true" : undefined}
										aria-current={active ? "page" : undefined}
										onClick={handleNavClick}
										style={{
											gap: "var(--space-3)",
											padding: "var(--space-3)",
											borderBottom: "none",
											borderRadius: "var(--radius-md)",
											color: active
												? "var(--color-accent-primary)"
												: "var(--fg-default)",
											// Leave the background to CSS for the inactive rows so the
											// `.list-row:hover` tint still applies.
											background: active
												? "var(--color-surface-selected)"
												: undefined,
											textDecoration: "none",
											fontSize: "var(--text-base)",
											fontWeight: active ? 500 : 400,
											transition:
												"color var(--transition-fast), background var(--transition-fast)",
										}}
									>
										<span
											style={{
												display: "flex",
												flexShrink: 0,
												color: active
													? "var(--color-accent-primary)"
													: "var(--fg-dim)",
											}}
										>
											<Icon name={item.icon} />
										</span>
										{item.label}
									</Link>
								</li>
							);
						})}
					</ul>
				</div>
			</nav>

			{/* User profile & logout — ONE card (R3). The account block and the logout
			 * action are no longer two siblings that touch: the logout control is a
			 * ghost button inside the same card, below a hairline separator, so the
			 * two read as one grouped unit and the action stays reachable. */}
			<div className="sidebar-user-card">
				<div className="sidebar-user-account">
					<div
						style={{
							width: 36,
							height: 36,
							flexShrink: 0,
							background: "var(--color-accent-primary)",
							borderRadius: "var(--radius-full)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							fontSize: "var(--text-sm)",
							fontWeight: "var(--weight-semibold)",
							color: "var(--color-text-inverse)",
						}}
					>
						{admin?.name?.charAt(0).toUpperCase() || "A"}
					</div>
					<div style={{ flex: 1, minWidth: 0 }}>
						<div
							style={{
								fontSize: "var(--text-base)",
								fontWeight: "var(--weight-medium)",
								color: "var(--fg-strong)",
								whiteSpace: "nowrap",
								overflow: "hidden",
								textOverflow: "ellipsis",
							}}
						>
							{admin?.name || t("navigation.administrator")}
						</div>
						<div
							style={{
								fontSize: "var(--text-xs)",
								color: "var(--fg-dim)",
								whiteSpace: "nowrap",
								overflow: "hidden",
								textOverflow: "ellipsis",
							}}
						>
							{admin?.email}
						</div>
					</div>
				</div>

				<button
					type="button"
					className="btn btn-ghost sidebar-user-logout"
					onClick={handleLogout}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						aria-hidden="true"
						style={{ display: "block" }}
					>
						<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
						<polyline points="16 17 21 12 16 7" />
						<line x1="21" y1="12" x2="9" y2="12" />
					</svg>
					{t("buttons.logout")}
				</button>
			</div>
		</>
	);

	return (
		<div className="app-shell">
			{/* Mobile Header */}
			{isMobile && (
				<header className="mobile-header">
					{/*
					 * 44x44px touch target (#15) and `z-index: 45` from
					 * `.hamburger-btn` so the scrolling `<main>` can never paint
					 * over it. `aria-controls`/`aria-expanded` expose the drawer
					 * state; the class carries the sizing contract in index.css.
					 */}
					<button
						type="button"
						onClick={() => setSidebarOpen(true)}
						aria-label="Open menu"
						aria-controls="mobile-sidebar"
						aria-expanded={sidebarOpen}
						className="hamburger-btn"
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							width: "44px",
							height: "44px",
							minWidth: "44px",
							minHeight: "44px",
							padding: 0,
							background: "transparent",
							border: "none",
							color: "var(--color-text-primary)",
							cursor: "pointer",
							borderRadius: "var(--radius-md)",
							position: "relative",
							zIndex: 45,
						}}
					>
						<svg
							width="24"
							height="24"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							aria-hidden="true"
							style={{ display: "block" }}
						>
							<line x1="3" y1="6" x2="21" y2="6" />
							<line x1="3" y1="12" x2="21" y2="12" />
							<line x1="3" y1="18" x2="21" y2="18" />
						</svg>
					</button>
					<Link to="/" style={{ textDecoration: "none" }}>
						<span
							style={{
								fontFamily: "var(--font-display)",
								fontSize: "var(--text-lg)",
								fontWeight: 600,
								letterSpacing: "-0.01em",
								color: "var(--fg-strong)",
							}}
						>
							{t("appName")}
						</span>
					</Link>
					<div style={{ width: "44px" }} aria-hidden="true" />
				</header>
			)}

			{/* Sidebar Overlay (Mobile) */}
			{isMobile && (
				<div
					className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`}
					onClick={() => setSidebarOpen(false)}
				/>
			)}

			{/* Sidebar */}
			{isMobile ? (
				<aside
					id="mobile-sidebar"
					data-testid="mobile-sidebar"
					data-open={sidebarOpen ? "true" : "false"}
					className={`mobile-sidebar glass-sidebar ${sidebarOpen ? "open" : ""}`}
					style={{
						display: "flex",
						flexDirection: "column",
					}}
				>
					<SidebarContent />
				</aside>
			) : (
				<aside
					className="glass-sidebar"
					style={{
						width: "var(--sidebar-width)",
						display: "flex",
						flexDirection: "column",
						position: "fixed",
						top: 0,
						left: 0,
						bottom: 0,
						zIndex: 50,
					}}
				>
					<SidebarContent />
				</aside>
			)}

			{/*
			 * `minWidth: 0` lets the flex child shrink below its content width and
			 * at mobile width `overflowX: 'hidden'` is the last line of defence
			 * against a 375px horizontal scrollbar. Desktop keeps `overflow: auto`
			 * untouched (only the harmless `minWidth: 0` applies there), so no
			 * desktop restyle happens.
			 */}
			<main
				className={isMobile ? "mobile-main" : ""}
				data-testid="admin-main"
				style={{
					flex: 1,
					marginLeft: isMobile ? 0 : "var(--sidebar-width)",
					minHeight: "100vh",
					minWidth: 0,
					overflow: "auto",
					overflowX: isMobile ? "hidden" : "auto",
				}}
			>
				{children}
			</main>
		</div>
	);
}
