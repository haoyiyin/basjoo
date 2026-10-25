"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../services/api";
import type { EmbeddingProvider, KnowledgeBaseDetail } from "../services/api";

/** Default embedding model for each provider, used to prefill the form. */
export const PROVIDER_DEFAULT_MODELS: Record<EmbeddingProvider, string> = {
	jina: "jina-embeddings-v3",
	siliconflow: "BAAI/bge-m3",
	custom: "text-embedding-v4",
	local: "ibm-granite/granite-embedding-97m-multilingual-r2",
};

/**
 * Values collected by the KB form. In `reset` mode `name`, `chunk_size` and
 * `chunk_overlap` are not rendered and keep their initial/default values; the
 * caller decides which fields to forward to the API.
 */
export interface KbFormValues {
	name: string;
	embedding_provider: EmbeddingProvider;
	embedding_model: string;
	embedding_base_url: string | null;
	embedding_api_key: string;
	embedding_batch_size: number;
	chunk_size: number;
	chunk_overlap: number;
}

export interface KbFormModalProps {
	mode: "create" | "reset";
	initial?: Partial<KnowledgeBaseDetail>;
	onSubmit: (values: KbFormValues) => Promise<void>;
	onClose: () => void;
	submitError?: string | null;
}

const DEFAULT_BATCH_SIZE = 4;
const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_CHUNK_OVERLAP = 64;

function isHttpUrl(value: string): boolean {
	return /^https?:\/\/.+/i.test(value.trim());
}

export default function KbFormModal({
	mode,
	initial,
	onSubmit,
	onClose,
	submitError,
}: KbFormModalProps) {
	const { t } = useTranslation("common");
	const initialProvider: EmbeddingProvider =
		initial?.embedding_provider ?? "jina";
	const [name, setName] = useState(initial?.name ?? "");
	const [provider, setProvider] =
		useState<EmbeddingProvider>(initialProvider);
	const [model, setModel] = useState(
		initial?.embedding_model ?? PROVIDER_DEFAULT_MODELS[initialProvider],
	);
	const [baseUrl, setBaseUrl] = useState(initial?.embedding_base_url ?? "");
	const [apiKey, setApiKey] = useState("");
	const [batchSize, setBatchSize] = useState(
		initial?.embedding_batch_size ?? DEFAULT_BATCH_SIZE,
	);
	const [chunkSize, setChunkSize] = useState(
		initial?.chunk_size ?? DEFAULT_CHUNK_SIZE,
	);
	const [chunkOverlap, setChunkOverlap] = useState(
		initial?.chunk_overlap ?? DEFAULT_CHUNK_OVERLAP,
	);
	const [testing, setTesting] = useState(false);
	const [testResult, setTestResult] = useState<{
		success: boolean;
		dimension: number | null;
		message: string;
	} | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);

	const isCreate = mode === "create";
	const baseUrlRequired = provider === "custom";
	// The bundled local provider needs neither an API key nor a base URL: the
	// backend resolves both from its own settings.
	const isLocalProvider = provider === "local";
	const errorMessage = formError ?? submitError ?? null;

	const handleProviderChange = (next: EmbeddingProvider) => {
		setProvider(next);
		setModel(PROVIDER_DEFAULT_MODELS[next]);
		setTestResult(null);
		if (next !== "custom") {
			setBaseUrl("");
		}
		if (next === "local") {
			setApiKey("");
		}
	};

	const validate = (): string | null => {
		if (isCreate && !name.trim()) {
			return t("kbForm.nameRequired");
		}
		if (!model.trim()) {
			return t("kbForm.modelRequired");
		}
		if (baseUrlRequired && !isHttpUrl(baseUrl)) {
			return t("kbForm.baseUrlInvalid");
		}
		if (isCreate && !isLocalProvider && !apiKey.trim()) {
			return t("kbForm.apiKeyRequired");
		}
		if (chunkOverlap >= chunkSize) {
			return t("kbForm.chunkOverlapInvalid");
		}
		return null;
	};

	const buildValues = (): KbFormValues => ({
		name: name.trim(),
		embedding_provider: provider,
		embedding_model: model.trim(),
		embedding_base_url: baseUrlRequired ? baseUrl.trim() : null,
		embedding_api_key: isLocalProvider ? "" : apiKey.trim(),
		embedding_batch_size: batchSize,
		chunk_size: chunkSize,
		chunk_overlap: chunkOverlap,
	});

	const handleTest = async () => {
		setTesting(true);
		setTestResult(null);
		setFormError(null);
		try {
			const result = await api.testEmbeddingConfig({
				embedding_provider: provider,
				embedding_model: model.trim(),
				embedding_base_url: baseUrlRequired ? baseUrl.trim() : null,
				embedding_api_key: isLocalProvider ? "" : apiKey.trim(),
			});
			setTestResult(result);
		} catch (err) {
			setTestResult({
				success: false,
				dimension: null,
				message:
					err instanceof Error ? err.message : t("knowledgeBases.errors.testFailed"),
			});
		} finally {
			setTesting(false);
		}
	};

	const handleSubmit = async () => {
		if (submitting) return;
		const validationError = validate();
		if (validationError) {
			setFormError(validationError);
			return;
		}
		setFormError(null);
		setSubmitting(true);
		try {
			await onSubmit(buildValues());
		} catch (err) {
			setFormError(
				err instanceof Error ? err.message : t("knowledgeBases.errors.saveFailed"),
			);
		} finally {
			setSubmitting(false);
		}
	};

	const labelStyle = {
		display: "block",
		marginBottom: "var(--space-2)",
		fontSize: "var(--text-sm)",
		fontWeight: 500,
		color: "var(--color-text-secondary)",
	} as const;

	return (
		<div
			data-testid="kb-form-modal"
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 9999,
				background: "rgba(0, 0, 0, 0.5)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				overflowY: "auto",
			}}
			onClick={onClose}
		>
			<div
				className="liquid-glass-card"
				role="dialog"
				aria-modal="true"
				style={{
					padding: "var(--space-6)",
					maxWidth: "520px",
					width: "100%",
					margin: "var(--space-4)",
				}}
				onClick={(event) => event.stopPropagation()}
			>
				<h3
					style={{
						fontSize: "var(--text-lg)",
						fontWeight: 600,
						marginBottom: "var(--space-1)",
						color: "var(--color-text-primary)",
					}}
				>
					{isCreate
						? t("kbForm.createTitle")
						: t("kbForm.resetTitle")}
				</h3>
				<p
					style={{
						fontSize: "var(--text-sm)",
						marginBottom: "var(--space-6)",
						color: "var(--color-text-muted)",
					}}
				>
					{isCreate
						? t("kbForm.createDescription")
						: t("kbForm.resetDescription")}
				</p>

				{errorMessage && (
					<div
						style={{
							padding: "var(--space-3) var(--space-4)",
							borderRadius: "var(--radius-md)",
							fontSize: "var(--text-sm)",
							background: "var(--color-error-bg)",
							border: "1px solid var(--color-error)",
							color: "var(--color-error)",
							marginBottom: "var(--space-4)",
						}}
					>
						{errorMessage}
					</div>
				)}

				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: "var(--space-5)",
					}}
				>
					{isCreate && (
						<div>
							<label style={labelStyle} htmlFor="kb-form-name">
								{t("kbForm.name")}
							</label>
							<input
								id="kb-form-name"
								type="text"
								value={name}
								maxLength={100}
								onChange={(event) => setName(event.target.value)}
								placeholder={t("kbForm.namePlaceholder")}
							/>
						</div>
					)}

					<div>
						<label style={labelStyle} htmlFor="kb-form-provider">
							{t("kbForm.provider")}
						</label>
						<select
							id="kb-form-provider"
							value={provider}
							onChange={(event) =>
								handleProviderChange(event.target.value as EmbeddingProvider)
							}
						>
							<option value="jina">{t("kbForm.providerJina")}</option>
							<option value="siliconflow">
								{t("kbForm.providerSiliconflow")}
							</option>
							<option value="custom">{t("kbForm.providerCustom")}</option>
							<option value="local">{t("kbForm.providerLocal")}</option>
						</select>
					</div>

					<div>
						<label style={labelStyle} htmlFor="kb-form-model">
							{t("kbForm.model")}
						</label>
						<input
							id="kb-form-model"
							type="text"
							value={model}
							onChange={(event) => setModel(event.target.value)}
							placeholder={PROVIDER_DEFAULT_MODELS[provider]}
						/>
					</div>

					{baseUrlRequired && (
						<div>
							<label style={labelStyle} htmlFor="kb-form-base-url">
								{t("kbForm.baseUrl")}
							</label>
							<input
								id="kb-form-base-url"
								type="text"
								value={baseUrl}
								onChange={(event) => setBaseUrl(event.target.value)}
								placeholder="https://api.example.com/v1"
							/>
						</div>
					)}

					<div>
						{!isLocalProvider && (
							<>
								<label style={labelStyle} htmlFor="kb-form-api-key">
									{t("kbForm.apiKey")}
								</label>
								<input
									id="kb-form-api-key"
									type="password"
									value={apiKey}
									onChange={(event) => {
										setApiKey(event.target.value);
										setTestResult(null);
									}}
									placeholder={
										isCreate
											? t("kbForm.apiKeyPlaceholder")
											: t("kbForm.apiKeyKeepPlaceholder")
									}
								/>
							</>
						)}
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "var(--space-3)",
								marginTop: "var(--space-2)",
							}}
						>
							<button
								type="button"
								className="btn-secondary"
								onClick={handleTest}
								disabled={testing || (!isLocalProvider && !apiKey.trim())}
							>
								{testing ? t("status.testing") : t("kbForm.testConnection")}
							</button>
							{testResult && (
								<span
									style={{
										fontSize: "var(--text-xs)",
										color: testResult.success
											? "var(--color-success)"
											: "var(--color-error)",
									}}
								>
									{testResult.success
										? t("kbForm.testSuccess", {
												dimension: testResult.dimension ?? "?",
											})
										: testResult.message}
								</span>
							)}
						</div>
					</div>

					<div>
						<label style={labelStyle} htmlFor="kb-form-batch-size">
							{t("kbForm.batchSize")}
						</label>
						<input
							id="kb-form-batch-size"
							type="number"
							min={1}
							max={64}
							value={batchSize}
							onChange={(event) => setBatchSize(Number(event.target.value))}
						/>
					</div>

					{isCreate && (
						<div
							style={{
								display: "grid",
								gridTemplateColumns: "1fr 1fr",
								gap: "var(--space-4)",
							}}
						>
							<div>
								<label style={labelStyle} htmlFor="kb-form-chunk-size">
									{t("kbForm.chunkSize")}
								</label>
								<input
									id="kb-form-chunk-size"
									type="number"
									min={128}
									max={2048}
									value={chunkSize}
									onChange={(event) => setChunkSize(Number(event.target.value))}
								/>
							</div>
							<div>
								<label style={labelStyle} htmlFor="kb-form-chunk-overlap">
									{t("kbForm.chunkOverlap")}
								</label>
								<input
									id="kb-form-chunk-overlap"
									type="number"
									min={0}
									max={512}
									value={chunkOverlap}
									onChange={(event) =>
										setChunkOverlap(Number(event.target.value))
									}
								/>
							</div>
						</div>
					)}
				</div>

				<div
					style={{
						display: "flex",
						gap: "var(--space-3)",
						justifyContent: "flex-end",
						marginTop: "var(--space-6)",
					}}
				>
					<button
						type="button"
						className="btn-secondary"
						onClick={onClose}
						disabled={submitting}
					>
						{t("buttons.cancel")}
					</button>
					<button
						type="button"
						className="btn-primary"
						onClick={handleSubmit}
						disabled={submitting}
					>
						{submitting
							? t("status.saving")
							: isCreate
								? t("kbForm.createSubmit")
								: t("kbForm.resetSubmit")}
					</button>
				</div>
			</div>
		</div>
	);
}
