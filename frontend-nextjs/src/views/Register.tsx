"use client";

import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTranslation } from "react-i18next";
import { API_BASE_URL } from "../lib/env";

/**
 * First-run super-admin registration (spec §20).
 *
 * Same standalone auth surface as `Login`: one centred `.card`, solid surface,
 * 1px border, soft shadow. The bootstrap gate, the password guards, the
 * register payload and the post-success navigation are unchanged.
 */
export const Register = () => {
	const { t } = useTranslation("auth");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	const [checking, setChecking] = useState(true);
	const [bootstrapAllowed, setBootstrapAllowed] = useState(false);
	const { register } = useAuth();
	const navigate = useNavigate();

	useEffect(() => {
		fetch(`${API_BASE_URL}/api/admin/registration-settings`)
			.then((res) => res.json())
			.then((data) => {
				if (!data.bootstrap_required) {
					navigate("/login", { replace: true });
				} else {
					setBootstrapAllowed(true);
					setChecking(false);
				}
			})
			.catch(() => {
				setError(t("errors.setupCheckFailed"));
				setChecking(false);
			});
	}, [navigate, t]);

	const handleRegister = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");

		if (password !== confirmPassword) {
			setError(t("errors.passwordMismatch"));
			return;
		}

		if (password.length < 8) {
			setError(t("errors.passwordTooShort"));
			return;
		}

		setLoading(true);
		try {
			await register(email, password, name);
			navigate("/", { replace: true });
		} catch (err: unknown) {
			const message =
				err instanceof Error ? err.message : t("errors.setupFailed");
			setError(message);
		} finally {
			setLoading(false);
		}
	};

	if (checking) {
		return (
			<div className="auth-page" style={{ minHeight: "100vh", minWidth: 0 }}>
				<div className="spinner" aria-hidden="true" />
			</div>
		);
	}

	if (!bootstrapAllowed) {
		return (
			<div className="auth-page" style={{ minHeight: "100vh", minWidth: 0 }}>
				<div style={{ width: "100%", maxWidth: "420px", minWidth: 0 }}>
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
					<Link
						to="/login"
						className="btn btn-secondary"
						style={{ width: "100%", minHeight: 44 }}
					>
						{t("initialSetup.loginLink")}
					</Link>
				</div>
			</div>
		);
	}

	return (
		<div
			className="auth-page"
			data-testid="register-page"
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
						{t("initialSetup.title")}
					</h1>
					<p className="page-subtitle" style={{ marginTop: "var(--space-1)" }}>
						{t("initialSetup.subtitle")}
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

					<form onSubmit={handleRegister}>
						<div className="field">
							<label className="field-label" htmlFor="register-name">
								{t("initialSetup.name")}
							</label>
							<input
								id="register-name"
								className="input"
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder={t("initialSetup.namePlaceholder")}
								required
								disabled={loading}
							/>
						</div>

						<div className="field">
							<label className="field-label" htmlFor="register-email">
								{t("initialSetup.email")}
							</label>
							<input
								id="register-email"
								className="input"
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder={t("initialSetup.emailPlaceholder")}
								required
								disabled={loading}
							/>
						</div>

						<div className="field">
							<label className="field-label" htmlFor="register-password">
								{t("initialSetup.password")}
							</label>
							<input
								id="register-password"
								className="input"
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder={t("initialSetup.passwordPlaceholder")}
								required
								disabled={loading}
							/>
						</div>

						<div className="field">
							<label className="field-label" htmlFor="register-confirm-password">
								{t("initialSetup.confirmPassword")}
							</label>
							<input
								id="register-confirm-password"
								className="input"
								type="password"
								value={confirmPassword}
								onChange={(e) => setConfirmPassword(e.target.value)}
								placeholder={t("initialSetup.confirmPasswordPlaceholder")}
								required
								disabled={loading}
							/>
						</div>

						<button
							type="submit"
							disabled={loading}
							className="btn btn-primary"
							style={{ width: "100%", minHeight: 44 }}
						>
							{loading ? (
								<>
									<div className="spinner" aria-hidden="true" />
									{t("initialSetup.registerInProgress")}
								</>
							) : (
								t("initialSetup.registerButton")
							)}
						</button>
					</form>
				</div>

				<p
					style={{
						textAlign: "center",
						marginTop: "var(--space-4)",
						fontSize: "var(--text-sm)",
						lineHeight: "var(--leading-snug)",
						color: "var(--fg-dim)",
					}}
				>
					{t("initialSetup.haveAccount")}{" "}
					<Link
						to="/login"
						style={{
							color: "var(--color-accent-primary)",
							fontWeight: 500,
							textDecoration: "none",
						}}
					>
						{t("initialSetup.loginLink")}
					</Link>
				</p>

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
					{t("initialSetup.footer")}
				</p>
			</div>
		</div>
	);
};
