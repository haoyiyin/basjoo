"use client";

import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTranslation } from "react-i18next";

export const Login = () => {
	const { t } = useTranslation("auth");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	const [bootstrapRequired, setBootstrapRequired] = useState(false);
	const [hydrated, setHydrated] = useState(false);

	useEffect(() => {
		setHydrated(true);
	}, []);
	const { login } = useAuth();
	const navigate = useNavigate();

	useEffect(() => {
		fetch("/api/admin/registration-settings")
			.then((res) => res.json())
			.then((data) => {
				const required = Boolean(data.bootstrap_required);
				setBootstrapRequired(required);
				if (required) {
					navigate("/register");
				}
			})
			.catch(() => setBootstrapRequired(false));
	}, [navigate]);

	const handleLogin = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setLoading(true);

		try {
			await login(email, password);
			navigate("/");
		} catch (err: unknown) {
			const message =
				err instanceof Error ? err.message : t("errors.loginFailed");
			setError(message);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div
			style={{
				minHeight: "100vh",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				padding: "var(--space-6)",
				position: "relative",
			}}
		>
			{/* Liquid blob background */}
			<div className="liquid-blob-container">
				<div
					className="liquid-blob-1"
					style={{ top: "5%", left: "5%", width: "40vw", height: "40vw" }}
				/>
				<div
					className="liquid-blob-2"
					style={{ bottom: "5%", right: "5%", width: "45vw", height: "45vw" }}
				/>
			</div>

			<div
				style={{
					width: "100%",
					maxWidth: "420px",
					animation: "fadeIn 0.6s cubic-bezier(0.25, 1.1, 0.5, 1.15) forwards",
				}}
			>
				{/* Logo & title */}
				<div
					style={{
						textAlign: "center",
						marginBottom: "var(--space-10)",
					}}
				>
					<div
						style={{
							display: "inline-flex",
							alignItems: "center",
							justifyContent: "center",
							width: "80px",
							height: "80px",
							marginBottom: "var(--space-6)",
							filter: "drop-shadow(0 0 20px hsla(188deg, 90%, 50%, 0.3))",
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
					<h1
						style={{
							fontSize: "var(--text-3xl)",
							fontWeight: 700,
							marginBottom: "var(--space-3)",
							background:
								"linear-gradient(135deg, hsl(188deg, 90%, 50%) 0%, hsl(265deg, 90%, 65%) 100%)",
							WebkitBackgroundClip: "text",
							backgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						Basjoo
					</h1>
					<p
						style={{
							color: "var(--color-text-secondary)",
							fontSize: "var(--text-base)",
						}}
					>
						{t("login.subtitle")}
					</p>
				</div>

				{/* Login form card */}
				<div
					className="liquid-glass-card"
					style={{
						padding: "var(--space-8)",
					}}
				>
					{error && (
						<div
							style={{
								background: "var(--color-error-bg)",
								color: "var(--color-error)",
								padding: "var(--space-4)",
								borderRadius: "var(--radius-md)",
								marginBottom: "var(--space-6)",
								fontSize: "var(--text-sm)",
								display: "flex",
								alignItems: "center",
								gap: "var(--space-3)",
								border: "1px solid hsla(350deg, 85%, 58%, 0.2)",
							}}
						>
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
							>
								<circle cx="12" cy="12" r="10" />
								<line x1="12" y1="8" x2="12" y2="12" />
								<line x1="12" y1="16" x2="12.01" y2="16" />
							</svg>
							{error}
						</div>
					)}

					<form onSubmit={handleLogin}>
						<div style={{ marginBottom: "var(--space-5)" }}>
							<label
								style={{
									display: "block",
									marginBottom: "var(--space-2)",
									fontSize: "var(--text-sm)",
									fontWeight: 500,
									color: "var(--color-text-secondary)",
								}}
							>
								{t("login.email")}
							</label>
							<div style={{ position: "relative" }}>
								<input
									type="email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									placeholder={t("login.emailPlaceholder")}
									required
									disabled={loading}
									style={{
										paddingLeft: "var(--space-12)",
									}}
								/>
								<svg
									width="18"
									height="18"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									style={{
										position: "absolute",
										left: "var(--space-4)",
										top: "50%",
										transform: "translateY(-50%)",
										color: "var(--color-text-muted)",
									}}
								>
									<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
									<polyline points="22,6 12,13 2,6" />
								</svg>
							</div>
						</div>

						<div style={{ marginBottom: "var(--space-6)" }}>
							<label
								style={{
									display: "block",
									marginBottom: "var(--space-2)",
									fontSize: "var(--text-sm)",
									fontWeight: 500,
									color: "var(--color-text-secondary)",
								}}
							>
								{t("login.password")}
							</label>
							<div style={{ position: "relative" }}>
								<input
									type="password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									placeholder={t("login.passwordPlaceholder")}
									required
									disabled={loading}
									style={{
										paddingLeft: "var(--space-12)",
									}}
								/>
								<svg
									width="18"
									height="18"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									style={{
										position: "absolute",
										left: "var(--space-4)",
										top: "50%",
										transform: "translateY(-50%)",
										color: "var(--color-text-muted)",
									}}
								>
									<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
									<path d="M7 11V7a5 5 0 0 1 10 0v4" />
								</svg>
							</div>
						</div>

						<button
							type="submit"
							disabled={loading || !hydrated}
							className="btn-primary"
							style={{
								width: "100%",
								padding: "var(--space-4)",
								fontSize: "var(--text-base)",
							}}
						>
							{loading ? (
								<>
									<div className="spinner" />
									{t("login.loginInProgress")}
								</>
							) : (
								<>
									{t("login.loginButton")}
									<svg
										width="18"
										height="18"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
									>
										<path d="M5 12h14M12 5l7 7-7 7" />
									</svg>
								</>
							)}
						</button>
					</form>
				</div>

				{bootstrapRequired && (
					<p
						style={{
							textAlign: "center",
							marginTop: "var(--space-6)",
							color: "var(--color-text-secondary)",
							fontSize: "var(--text-sm)",
						}}
					>
						{t("login.setupPrompt")}{" "}
						<Link
							to="/register"
							style={{
								color: "var(--color-accent-primary)",
								fontWeight: 500,
								textDecoration: "none",
								transition: "color var(--transition-fast)",
							}}
						>
							{t("login.setupLink")}
						</Link>
					</p>
				)}

				<div
					style={{
						textAlign: "center",
						marginTop: "var(--space-10)",
						paddingTop: "var(--space-6)",
						borderTop: "1px solid var(--color-border)",
					}}
				>
					<p
						style={{
							fontSize: "var(--text-xs)",
							color: "var(--color-text-muted)",
						}}
					>
						{t("login.footer")}
					</p>
				</div>
			</div>
		</div>
	);
};
