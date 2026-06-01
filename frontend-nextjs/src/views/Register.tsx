"use client";

import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTranslation } from "react-i18next";
import { API_BASE_URL } from "../lib/env";

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
			<div
				style={{
					minHeight: "100vh",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					color: "var(--color-text-secondary)",
				}}
			>
				<div className="spinner" />
			</div>
		);
	}

	if (!bootstrapAllowed) {
		return (
			<div
				style={{
					minHeight: "100vh",
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					padding: "var(--space-6)",
					gap: "var(--space-6)",
				}}
			>
				{error && (
					<div
						style={{
							background: "var(--color-error-bg)",
							color: "var(--color-error)",
							padding: "var(--space-4)",
							borderRadius: "var(--radius-md)",
							fontSize: "var(--text-sm)",
						}}
					>
						{error}
					</div>
				)}
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
			</div>
		);
	}

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
					style={{
						top: "10%",
						right: "10%",
						left: "auto",
						width: "45vw",
						height: "45vw",
					}}
				/>
				<div
					className="liquid-blob-2"
					style={{
						bottom: "10%",
						left: "10%",
						right: "auto",
						width: "40vw",
						height: "40vw",
					}}
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
						marginBottom: "var(--space-8)",
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
							filter: "drop-shadow(0 0 20px hsla(265deg, 90%, 65%, 0.3))",
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
								"linear-gradient(135deg, hsl(265deg, 90%, 65%) 0%, hsl(188deg, 90%, 50%) 100%)",
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
						{t("initialSetup.subtitle")}
					</p>
				</div>

				{/* Register form card */}
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

					<form onSubmit={handleRegister}>
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
								{t("initialSetup.name")}
							</label>
							<div style={{ position: "relative" }}>
								<input
									type="text"
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder={t("initialSetup.namePlaceholder")}
									required
									disabled={loading}
									style={{ paddingLeft: "var(--space-12)" }}
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
									<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
									<circle cx="12" cy="7" r="4" />
								</svg>
							</div>
						</div>

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
								{t("initialSetup.email")}
							</label>
							<div style={{ position: "relative" }}>
								<input
									type="email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									placeholder={t("initialSetup.emailPlaceholder")}
									required
									disabled={loading}
									style={{ paddingLeft: "var(--space-12)" }}
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
								{t("initialSetup.password")}
							</label>
							<div style={{ position: "relative" }}>
								<input
									type="password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									placeholder={t("initialSetup.passwordPlaceholder")}
									required
									disabled={loading}
									style={{ paddingLeft: "var(--space-12)" }}
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
								{t("initialSetup.confirmPassword")}
							</label>
							<div style={{ position: "relative" }}>
								<input
									type="password"
									value={confirmPassword}
									onChange={(e) => setConfirmPassword(e.target.value)}
									placeholder={t("initialSetup.confirmPasswordPlaceholder")}
									required
									disabled={loading}
									style={{ paddingLeft: "var(--space-12)" }}
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
									<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
								</svg>
							</div>
						</div>

						<button
							type="submit"
							disabled={loading}
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
									{t("initialSetup.registerInProgress")}
								</>
							) : (
								<>
									{t("initialSetup.registerButton")}
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

				<p
					style={{
						textAlign: "center",
						marginTop: "var(--space-6)",
						color: "var(--color-text-secondary)",
						fontSize: "var(--text-sm)",
					}}
				>
					{t("initialSetup.haveAccount")}{" "}
					<Link
						to="/login"
						style={{
							color: "var(--color-accent-primary)",
							fontWeight: 500,
							textDecoration: "none",
							transition: "color var(--transition-fast)",
						}}
					>
						{t("initialSetup.loginLink")}
					</Link>
				</p>

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
						{t("initialSetup.footer")}
					</p>
				</div>
			</div>
		</div>
	);
};
