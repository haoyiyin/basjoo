"use client";

import { ReactNode, useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTranslation } from "react-i18next";
import { api } from "../services/api";

import { useIsMobile } from "../hooks/useMediaQuery";

interface AdminLayoutProps {
	children: ReactNode;
}

interface NavItem {
	path: string;
	i18nKey: string;
	icon: JSX.Element;
	children?: NavItem[];
}

const navItemsConfig: NavItem[] = [
	{
		path: "/",
		i18nKey: "navigation.dashboard",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<rect x="3" y="3" width="7" height="7" rx="1" />
				<rect x="14" y="3" width="7" height="7" rx="1" />
				<rect x="14" y="14" width="7" height="7" rx="1" />
				<rect x="3" y="14" width="7" height="7" rx="1" />
			</svg>
		),
	},
	{
		path: "/playground",
		i18nKey: "navigation.playground",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
			</svg>
		),
	},
	{
		path: "/agents",
		i18nKey: "navigation.agents",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<path d="M12 2v4" />
				<path d="M12 18v4" />
				<rect x="4" y="6" width="16" height="12" rx="3" />
				<path d="M8 12h.01" />
				<path d="M16 12h.01" />
				<path d="M9 16h6" />
			</svg>
		),
	},
	{
		path: "/knowledge",
		i18nKey: "navigation.knowledge",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
				<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
			</svg>
		),
		children: [
			{
				path: "/urls",
				i18nKey: "navigation.urlKnowledge",
				icon: (
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
					>
						<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
						<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
					</svg>
				),
			},
			{
				path: "/files",
				i18nKey: "navigation.fileManagement",
				icon: (
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
					>
						<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
						<polyline points="14 2 14 8 20 8" />
					</svg>
				),
			},
		],
	},
	{
		path: "/sessions",
		i18nKey: "navigation.sessions",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
				<circle cx="9" cy="7" r="4" />
				<path d="M23 21v-2a4 4 0 0 0-3-3.87" />
				<path d="M16 3.13a4 4 0 0 1 0 7.75" />
			</svg>
		),
	},
	{
		path: "/users",
		i18nKey: "navigation.users",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
				<circle cx="9" cy="7" r="4" />
				<path d="M19 8v6" />
				<path d="M22 11h-6" />
			</svg>
		),
	},
	{
		path: "/settings/system",
		i18nKey: "navigation.systemSettings",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<circle cx="12" cy="12" r="3" />
				<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
			</svg>
		),
	},
];

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

	// Build nav items based on role and context
	const scopedNavItems = agentId
		? navItemsConfig
				.filter((item) => item.path !== "/agents")
				.map((item) => ({
					...item,
					path:
						item.path === "/"
							? `${agentBasePath}/dashboard`
							: `${agentBasePath}${item.path}`,
					children: item.children?.map((child) => ({
						...child,
						path: `${agentBasePath}${child.path}`,
					})),
				}))
		: isSuperAdmin
			? navItemsConfig.filter(
					(item) => item.path === "/" || item.path === "/agents",
				)
			: []; // Non-super users at root level should redirect, show no nav

	const allowedNav =
		isSupport && agentId
			? scopedNavItems.filter(
					(item) => item.path === `${agentBasePath}/sessions`,
				)
			: scopedNavItems;

	const navItems = allowedNav.map((item) => ({
		...item,
		label: t(item.i18nKey),
	}));

	// Auto-expand knowledge group when child route is active
	const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
		const knowledgePath = agentId ? `${agentBasePath}/knowledge` : "/knowledge";
		if (
			location.pathname === knowledgePath ||
			location.pathname === `${agentBasePath}/urls` ||
			location.pathname === `${agentBasePath}/files`
		) {
			return new Set([knowledgePath]);
		}
		return new Set();
	});

	useEffect(() => {
		const knowledgePath = agentId ? `${agentBasePath}/knowledge` : "/knowledge";
		if (
			location.pathname === knowledgePath ||
			location.pathname === `${agentBasePath}/urls` ||
			location.pathname === `${agentBasePath}/files`
		) {
			setExpandedGroups((prev) => new Set([...prev, knowledgePath]));
		}
	}, [agentBasePath, agentId, location.pathname]);

	const isActive = (item: NavItem) => {
		if (item.path === location.pathname) return true;
		if (item.children) {
			return item.children.some((child) => child.path === location.pathname);
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

	// Water-drop indicator tracking
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

	// Re-measure after expand/collapse animations
	useEffect(() => {
		const timer = setTimeout(updateIndicator, 350);
		return () => clearTimeout(timer);
	}, [expandedGroups, updateIndicator]);

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

	const SidebarContent = () => (
		<>
			{/* Logo */}
			<div
				style={{
					padding: "var(--space-6)",
					borderBottom: "1px solid var(--color-border)",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					<Link
						to={
							isSuperAdmin
								? "/"
								: agentId
									? isSupport
										? `${agentBasePath}/sessions`
										: `${agentBasePath}/dashboard`
									: "/agent-selector"
						}
						style={{
							textDecoration: "none",
							display: "flex",
							alignItems: "center",
							gap: "var(--space-3)",
						}}
						onClick={handleLogoClick}
					>
						<div
							style={{
								width: "40px",
								height: "40px",
								borderRadius: "var(--radius-md)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								overflow: "hidden",
								boxShadow: "0 0 20px hsla(188deg, 90%, 50%, 0.2)",
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
						</div>
						<div>
							<h1
								style={{
									fontSize: "var(--text-lg)",
									fontWeight: 700,
									color: "var(--color-text-primary)",
									letterSpacing: "-0.02em",
									background:
										"linear-gradient(135deg, hsl(188deg, 90%, 50%) 0%, hsl(265deg, 90%, 65%) 100%)",
									WebkitBackgroundClip: "text",
									WebkitTextFillColor: "transparent",
									backgroundClip: "text",
								}}
							>
								{agentId ? agentName || t("status.loading") : t("appName")}
							</h1>
							<span
								style={{
									fontSize: "var(--text-xs)",
									color: "var(--color-text-muted)",
								}}
							>
								{t("tagline")}
							</span>
						</div>
					</Link>
				</div>
			</div>

			{agentId && (
				<div
					style={{
						padding: "var(--space-4) var(--space-6)",
						borderBottom: "1px solid var(--color-border)",
						display: "grid",
						gap: "var(--space-2)",
					}}
				>
					<Link
						to="/"
						onClick={handleLogoClick}
						style={{
							color: "var(--color-text-secondary)",
							textDecoration: "none",
							fontSize: "var(--text-sm)",
							padding: "var(--space-2) var(--space-3)",
							borderRadius: "var(--radius-md)",
							border: "1px solid var(--color-border)",
							background: "var(--color-bg-secondary)",
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						← {t("agents.panelTitle")}
					</Link>
				</div>
			)}

			{/* Navigation */}
			<nav
				style={{
					flex: 1,
					padding: "var(--space-4)",
					overflowY: "auto",
				}}
			>
				<div
					ref={navRef}
					style={{
						display: "flex",
						flexDirection: "column",
						gap: "var(--space-1)",
						position: "relative",
					}}
				>
					{/* Water-drop floating indicator */}
					{indicatorStyle.height > 0 && (
						<div
							style={{
								position: "absolute",
								left: "4px",
								top: `${indicatorStyle.top}px`,
								height: `${indicatorStyle.height}px`,
								width: "calc(100% - 8px)",
								background: "hsla(188deg, 90%, 50%, 0.08)",
								borderRadius: "var(--radius-md)",
								border: "1px solid hsla(188deg, 90%, 50%, 0.12)",
								transition:
									"top 400ms cubic-bezier(0.34, 1.56, 0.64, 1), height 300ms cubic-bezier(0.25, 1.1, 0.5, 1.15)",
								pointerEvents: "none",
								zIndex: 0,
							}}
						/>
					)}

					{navItems.map((item) => {
						const hasChildren = item.children && item.children.length > 0;
						const isExpanded = expandedGroups.has(item.path);
						const active = isActive(item);

						return (
							<div key={item.path} style={{ position: "relative", zIndex: 1 }}>
								<div style={{ display: "flex", alignItems: "center" }}>
									<Link
										to={item.path}
										data-nav-active={active ? "true" : undefined}
										onClick={() => {
											if (hasChildren) {
												setExpandedGroups(
													(prev) => new Set([...prev, item.path]),
												);
											}
											handleNavClick();
										}}
										style={{
											flex: 1,
											display: "flex",
											alignItems: "center",
											gap: "var(--space-3)",
											padding: "var(--space-3) var(--space-4)",
											borderRadius: "var(--radius-md)",
											color: active
												? "var(--color-accent-primary)"
												: "var(--color-text-secondary)",
											background: "transparent",
											textDecoration: "none",
											fontSize: "var(--text-sm)",
											fontWeight: active ? 600 : 400,
											transition:
												"color var(--transition-fast), font-weight var(--transition-fast)",
											position: "relative",
										}}
									>
										<span
											style={{
												display: "flex",
												opacity: active ? 1 : 0.6,
												transition: "opacity var(--transition-fast)",
												filter: active
													? "drop-shadow(0 0 6px hsla(188deg, 90%, 50%, 0.4))"
													: "none",
											}}
										>
											{item.icon}
										</span>
										{item.label}
									</Link>
									{hasChildren && (
										<button
											onClick={(e) => {
												e.preventDefault();
												setExpandedGroups((prev) => {
													const next = new Set(prev);
													if (next.has(item.path)) {
														next.delete(item.path);
													} else {
														next.add(item.path);
													}
													return next;
												});
											}}
											style={{
												padding: "var(--space-2)",
												background: "transparent",
												border: "none",
												cursor: "pointer",
												color: "var(--color-text-muted)",
												display: "flex",
												alignItems: "center",
												borderRadius: "var(--radius-sm)",
												transition: "color var(--transition-fast)",
											}}
										>
											<svg
												width="16"
												height="16"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="2"
												style={{
													transform: isExpanded
														? "rotate(90deg)"
														: "rotate(0deg)",
													transition:
														"transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1)",
												}}
											>
												<polyline points="9 18 15 12 9 6" />
											</svg>
										</button>
									)}
								</div>

								{hasChildren && isExpanded && (
									<div
										style={{
											marginLeft: "var(--space-4)",
											overflow: "hidden",
										}}
									>
										{item.children!.map((child) => {
											const childActive = location.pathname === child.path;
											return (
												<Link
													key={child.path}
													to={child.path}
													onClick={handleNavClick}
													style={{
														display: "flex",
														alignItems: "center",
														gap: "var(--space-3)",
														padding: "var(--space-2) var(--space-4)",
														paddingLeft: "var(--space-10)",
														borderRadius: "var(--radius-md)",
														color: childActive
															? "var(--color-accent-primary)"
															: "var(--color-text-secondary)",
														background: childActive
															? "hsla(188deg, 90%, 50%, 0.06)"
															: "transparent",
														textDecoration: "none",
														fontSize: "var(--text-sm)",
														fontWeight: childActive ? 500 : 400,
														transition: "all var(--transition-fast)",
														position: "relative",
													}}
												>
													{childActive && (
														<div
															style={{
																position: "absolute",
																left: "12px",
																top: "50%",
																transform: "translateY(-50%)",
																width: "4px",
																height: "4px",
																borderRadius: "50%",
																background: "var(--color-accent-primary)",
																boxShadow:
																	"0 0 8px hsla(188deg, 90%, 50%, 0.5)",
															}}
														/>
													)}
													<span
														style={{
															display: "flex",
															opacity: childActive ? 1 : 0.6,
															transition: "opacity var(--transition-fast)",
															filter: childActive
																? "drop-shadow(0 0 4px hsla(188deg, 90%, 50%, 0.3))"
																: "none",
														}}
													>
														{child.icon}
													</span>
													{t(child.i18nKey)}
												</Link>
											);
										})}
									</div>
								)}
							</div>
						);
					})}
				</div>
			</nav>

			{/* User profile & logout */}
			<div
				style={{
					padding: "var(--space-4)",
					borderTop: "1px solid var(--color-border)",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "var(--space-3)",
						padding: "var(--space-3)",
						background: "var(--sidebar-user-bg)",
						backdropFilter: "blur(12px)",
						WebkitBackdropFilter: "blur(12px)",
						border: "1px solid var(--color-border-glass)",
						borderRadius: "var(--radius-lg)",
						marginBottom: "var(--space-3)",
					}}
				>
					<div
						style={{
							width: "36px",
							height: "36px",
							background: "var(--color-accent-gradient)",
							borderRadius: "var(--radius-full)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							fontSize: "var(--text-sm)",
							fontWeight: 600,
							color: "var(--color-text-inverse)",
							boxShadow: "0 0 16px hsla(188deg, 90%, 50%, 0.25)",
						}}
					>
						{admin?.name?.charAt(0).toUpperCase() || "A"}
					</div>
					<div style={{ flex: 1, minWidth: 0 }}>
						<div
							style={{
								fontSize: "var(--text-sm)",
								fontWeight: 500,
								color: "var(--color-text-primary)",
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
								color: "var(--color-text-muted)",
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
					onClick={handleLogout}
					style={{
						width: "100%",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						gap: "var(--space-2)",
						padding: "var(--space-3)",
						background: "transparent",
						border: "1px solid var(--color-border)",
						borderRadius: "var(--radius-md)",
						color: "var(--color-text-secondary)",
						fontSize: "var(--text-sm)",
						cursor: "pointer",
						transition: "all var(--transition-fast)",
					}}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
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
		<div
			style={{
				display: "flex",
				minHeight: "100vh",
				background: "var(--color-bg-primary)",
			}}
		>
			{/* Mobile Header */}
			{isMobile && (
				<header className="mobile-header">
					<button
						onClick={() => setSidebarOpen(true)}
						aria-label="Open menu"
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							width: "40px",
							height: "40px",
							padding: 0,
							background: "transparent",
							border: "none",
							color: "var(--color-text-primary)",
							cursor: "pointer",
							borderRadius: "var(--radius-md)",
						}}
					>
						<svg
							width="24"
							height="24"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
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
								fontSize: "var(--text-lg)",
								fontWeight: 700,
								background:
									"linear-gradient(135deg, hsl(188deg, 90%, 50%) 0%, hsl(265deg, 90%, 65%) 100%)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
								backgroundClip: "text",
							}}
						>
							Basjoo AI
						</span>
					</Link>
					<div style={{ width: "40px" }} />
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

			<main
				className={isMobile ? "mobile-main" : ""}
				style={{
					flex: 1,
					marginLeft: isMobile ? 0 : "var(--sidebar-width)",
					minHeight: "100vh",
					overflow: "auto",
				}}
			>
				{children}
			</main>
		</div>
	);
}
