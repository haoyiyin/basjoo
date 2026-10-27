"use client";

import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTranslation } from "react-i18next";

/**
 * Sign-in screen (spec §20).
 *
 * Standalone auth route: no AdminLayout, one centred surface. Material is the
 * design-system default — solid `.card` on `--surface-bg`, one 1px border, the
 * soft shadow step. The pre-§12 aurora blobs, gradient wordmark and neon logo
 * glow are gone; the logo image, the language switcher (rendered by
 * `AuthLayout`) and the submit flow are unchanged.
 */
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
			className="auth-page"
			data-testid="login-page"
			style={{ minHeight: "100vh", minWidth: 0 }}
		>
			<div style={{ width: "100%", maxWidth: "420px", minWidth: 0 }}>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						textAlign: "center",
						marginBottom: "var(--space-6)",
					}}
				>
					<img
						src="/logo.png"
						alt="Basjoo Logo"
						style={{
							width: "48px",
							height: "48px",
							objectFit: "contain",
							marginBottom: "var(--space-4)",
						}}
					/>
					<h1 className="page-title" style={{ margin: 0 }}>
						{t("login.title")}
					</h1>
					<p className="page-subtitle" style={{ marginTop: "var(--space-1)" }}>
						{t("login.subtitle")}
					</p>
				</div>

				<div className="card">
					{error && (
						<div
							role="alert"
							style={{
								padding: "var(--space-3) var(--space-4)",
								borderRadius: "var(--radius-md)",
								fontSize: "var(--text-sm)",
								lineHeight: "var(--leading-snug)",
								background: "var(--color-error-bg)",
								border: "1px solid var(--color-error)",
								color: "var(--color-error)",
								marginBottom: "var(--space-4)",
							}}
						>
							{error}
						</div>
					)}

					<form onSubmit={handleLogin}>
						<div className="field">
							<label className="field-label" htmlFor="login-email">
								{t("login.email")}
							</label>
							<input
								id="login-email"
								className="input"
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder={t("login.emailPlaceholder")}
								required
								disabled={loading}
							/>
						</div>

						<div className="field">
							<label className="field-label" htmlFor="login-password">
								{t("login.password")}
							</label>
							<input
								id="login-password"
								className="input"
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder={t("login.passwordPlaceholder")}
								required
								disabled={loading}
							/>
						</div>

						<button
							type="submit"
							disabled={loading || !hydrated}
							className="btn btn-primary"
							style={{ width: "100%", minHeight: 44 }}
						>
							{loading ? (
								<>
									<div className="spinner" aria-hidden="true" />
									{t("login.loginInProgress")}
								</>
							) : (
								t("login.loginButton")
							)}
						</button>
					</form>
				</div>

				{bootstrapRequired && (
					<p
						style={{
							textAlign: "center",
							marginTop: "var(--space-4)",
							fontSize: "var(--text-sm)",
							lineHeight: "var(--leading-snug)",
							color: "var(--fg-dim)",
						}}
					>
						{t("login.setupPrompt")}{" "}
						<Link
							to="/register"
							style={{
								color: "var(--color-accent-primary)",
								fontWeight: 500,
								textDecoration: "none",
							}}
						>
							{t("login.setupLink")}
						</Link>
					</p>
				)}

				<p
					style={{
						textAlign: "center",
						marginTop: "var(--space-6)",
						paddingTop: "var(--space-4)",
						borderTop: "1px solid var(--color-border)",
						fontSize: "var(--text-xs)",
						lineHeight: "var(--leading-normal)",
						color: "var(--fg-dim)",
					}}
				>
					{t("login.footer")}
				</p>
			</div>
		</div>
	);
};
