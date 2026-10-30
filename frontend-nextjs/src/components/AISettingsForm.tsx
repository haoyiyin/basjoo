"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import HelpTooltip from "./HelpTooltip";
import { api } from "../services/api";
import type { Agent, ProviderType } from "../services/api";

type PersonaType = "general" | "customer-service" | "sales" | "custom";
type ApiFormatType = "openai" | "openai_compatible" | "anthropic" | "google";

const PERSONA_TYPES: PersonaType[] = [
	"general",
	"customer-service",
	"sales",
	"custom",
];
const SILICONFLOW_OFFICIAL_URL = "https://siliconflow.cn/";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

interface ChatParamOverrides {
	temperature: number;
	max_tokens: number;
}

interface AISettingsFormProps {
	agentId?: string;
	compact?: boolean;
	refreshSignal?: number;
	onSave?: (updatedAgent?: Agent) => void;
	onChatParamsChange?: (params: ChatParamOverrides) => void;
	onSaveBusyChange?: (busy: boolean) => void;
	onSaveError?: () => void;
}

export default function AISettingsForm({
	agentId,
	compact = false,
	refreshSignal,
	onSave,
	onChatParamsChange,
	onSaveBusyChange,
	onSaveError,
}: AISettingsFormProps) {
	const { t } = useTranslation("common");
	const [agent, setAgent] = useState<Agent | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [apiKeyError, setApiKeyError] = useState(false);
	const [selectedPersona, setSelectedPersona] = useState<PersonaType>("custom");
	const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const suppressAutoSaveRef = useRef(true);

	const [formData, setFormData] = useState({
		system_prompt: "",
		model: "",
		temperature: 0.7,
		api_key: "",
		api_base: "",
		provider_type: "deepseek" as ProviderType,
		api_format: "openai" as ApiFormatType,
		top_k: 8,
		similarity_threshold: 0.01,
		enable_context: false,
		rate_limit_per_minute: 20,
		restricted_reply: "",
		// #44: the model that answers once the daily allowance is spent.
		fallback_model: "",
		fallback_api_key: "",
	});
	const [personaError, setPersonaError] = useState(false);

	useEffect(() => {
		fetchAgent();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [refreshSignal]);

	useEffect(() => {
		return () => {
			if (saveTimeoutRef.current) {
				clearTimeout(saveTimeoutRef.current);
			}
		};
	}, []);

	useEffect(() => {
		onChatParamsChange?.({
			temperature: formData.temperature,
			max_tokens: agent?.max_tokens ?? 1024,
		});
	}, [agent?.max_tokens, formData.temperature, onChatParamsChange]);

	useEffect(() => {
		onSaveBusyChange?.(saving);
	}, [saving, onSaveBusyChange]);

	const fetchAgent = async () => {
		try {
			setLoading(true);
			setError(null);
			const agentData = agentId
				? await api.getAgent(agentId)
				: await api.getDefaultAgent();
			suppressAutoSaveRef.current = true;
			setAgent(agentData);

			const personaType = (agentData.persona_type as PersonaType) || "custom";
			setSelectedPersona(personaType);

			setFormData({
				system_prompt: agentData.system_prompt || "",
				model: agentData.model || DEFAULT_DEEPSEEK_MODEL,
				temperature: agentData.temperature ?? 0.7,
				api_key: "",
				api_base: agentData.api_base || "https://api.deepseek.com/v1",
				provider_type: agentData.provider_type || "deepseek",
				api_format: (agentData.api_format as ApiFormatType) || "openai",
				top_k: agentData.top_k ?? 8,
				similarity_threshold: agentData.similarity_threshold ?? 0.01,
				enable_context: agentData.enable_context ?? false,
				rate_limit_per_minute:
					agentData.rate_limit_per_minute ??
					agentData.rate_limit_per_hour ??
					20,
				restricted_reply:
					agentData.restricted_reply ?? t("labels.restrictedReplyPlaceholder"),
				// The fallback key is never returned; only a boolean, so the
				// input starts empty and a typed value replaces the stored one.
				fallback_model: agentData.fallback_model ?? "",
				fallback_api_key: "",
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : t("errors.loadFailed"));
		} finally {
			setLoading(false);
		}
	};

	const handlePersonaChange = (newPersona: PersonaType) => {
		setSelectedPersona(newPersona);
		if (newPersona === "custom" && selectedPersona !== "custom") {
			setFormData({
				...formData,
				system_prompt: "",
			});
		}
	};

	const handlePromptChange = (value: string) => {
		setFormData({ ...formData, system_prompt: value });
	};

	// 清除 AI API Key
	const handleClearAIKey = async () => {
		if (!agent) return;
		if (!confirm(t("labels.confirmClearAIKey"))) return;

		setSaving(true);
		try {
			const updatedAgent = await api.updateAgent(agent.id, { api_key: "" });
			suppressAutoSaveRef.current = true;
			setFormData({ ...formData, api_key: "" });
			setAgent(updatedAgent);
			onSave?.(updatedAgent);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("errors.saveFailed"));
		} finally {
			setSaving(false);
		}
	};

	const handleSave = useCallback(async () => {
		if (!agent) return;

		if (selectedPersona === "custom" && !formData.system_prompt.trim()) {
			setPersonaError(true);
			return;
		}

		setSaving(true);
		setError(null);
		setApiKeyError(false);

		let aiKeyTestFailed = false;

		try {
			const updateData: Partial<Agent> = {
				system_prompt: formData.system_prompt,
				model: formData.model,
				temperature: formData.temperature,
				api_base: formData.api_base,
				provider_type: formData.provider_type,
				api_format: formData.api_format,
				top_k: formData.top_k,
				similarity_threshold: formData.similarity_threshold,
				enable_context: formData.enable_context,
				rate_limit_per_minute: formData.rate_limit_per_minute,
				restricted_reply: formData.restricted_reply,
				persona_type: selectedPersona,
			};

			if (formData.api_key.trim()) {
				updateData.api_key = formData.api_key;
			}

			// #44: the fallback model round-trips unconditionally (an empty
			// string clears it); its key is only written when one was typed,
			// exactly like the primary key.
			updateData.fallback_model = formData.fallback_model;
			if (formData.fallback_api_key.trim()) {
				updateData.fallback_api_key = formData.fallback_api_key;
			}

			if (formData.api_key.trim()) {
				const aiTestResult = await api.testAIApi(agent.id, updateData);
				if (!aiTestResult.success) {
					aiKeyTestFailed = true;
					throw new Error(t("errors.aiApiTestFailed"));
				}
			}

			const updatedAgent = await api.updateAgent(agent.id, updateData);
			suppressAutoSaveRef.current = true;
			setAgent(updatedAgent);
			setFormData((prev) => ({
				...prev,
				api_key: "",
				fallback_api_key: "",
			}));
			onSave?.(updatedAgent);
		} catch (err) {
			let errorMessage: string;
			if (err instanceof Error) {
				errorMessage = err.message;
			} else if (typeof err === "object" && err !== null) {
				const errObj = err as Record<string, unknown>;
				if (typeof errObj.message === "string") {
					errorMessage = errObj.message;
				} else if (typeof errObj.detail === "string") {
					errorMessage = errObj.detail;
				} else if (
					typeof errObj.message === "object" &&
					errObj.message !== null
				) {
					errorMessage = JSON.stringify(errObj.message);
				} else {
					errorMessage = String(err) || t("errors.saveFailed");
				}
			} else {
				errorMessage = String(err) || t("errors.saveFailed");
			}
			if (aiKeyTestFailed) {
				setApiKeyError(true);
			}
			setError(errorMessage);
			onSaveError?.();
		} finally {
			setSaving(false);
		}
	}, [agent, formData, onSave, onSaveError, selectedPersona, t]);

	useEffect(() => {
		if (loading || !agent) {
			return;
		}

		if (suppressAutoSaveRef.current) {
			suppressAutoSaveRef.current = false;
			return;
		}

		if (saveTimeoutRef.current) {
			clearTimeout(saveTimeoutRef.current);
		}

		saveTimeoutRef.current = setTimeout(() => {
			void handleSave();
		}, 800);

		return () => {
			if (saveTimeoutRef.current) {
				clearTimeout(saveTimeoutRef.current);
			}
		};
	}, [
		agent,
		loading,
		selectedPersona,
		formData.system_prompt,
		formData.model,
		formData.temperature,
		formData.api_base,
		formData.provider_type,
		formData.api_format,
		formData.top_k,
		formData.similarity_threshold,
		formData.enable_context,
		formData.rate_limit_per_minute,
		formData.restricted_reply,
		formData.api_key,
		formData.fallback_model,
		formData.fallback_api_key,
		handleSave,
	]);

	// 默认 API Base URL
	const getDefaultApiBase = (provider: ProviderType): string => {
		switch (provider) {
			case "openai_native":
				return "https://api.openai.com/v1";
			case "google":
				return "https://generativelanguage.googleapis.com/v1beta";
			case "anthropic":
				return "https://api.anthropic.com/v1";
			case "xai":
				return "https://api.x.ai/v1";
			case "openrouter":
				return "https://openrouter.ai/api/v1";
			case "zai":
				return "https://api.z.ai/v1";
			case "deepseek":
				return "https://api.deepseek.com/v1";
			case "volcengine":
				return "https://ark.cn-beijing.volces.com/api/v3";
			case "tencentcloud":
				return "https://api.hunyuan.cloud.tencent.com/v1";
			case "moonshot":
				return "https://api.moonshot.cn/v1";
			case "aliyun_bailian":
				return "https://dashscope.aliyuncs.com/compatible-mode/v1";
			case "siliconflow":
				return "https://api.siliconflow.cn/v1";
			case "openai":
			default:
				return "https://api.openai.com/v1";
		}
	};

	// 默认模型名称
	const getDefaultModel = (provider: ProviderType): string => {
		switch (provider) {
			case "openai_native":
				return "gpt-6.1-sol";
			case "google":
				return "gemini-3.8-flash";
			case "anthropic":
				return "claude-sonnet-5-5";
			case "xai":
				return "grok-4.7";
			case "openrouter":
				return "openai/gpt-6.1-sol";
			case "zai":
				return "glm-5.3";
			case "deepseek":
				return DEFAULT_DEEPSEEK_MODEL;
			case "volcengine":
				return "doubao-seed-2-1-pro-260628";
			case "tencentcloud":
				return "hy3";
			case "moonshot":
				return "kimi-k3";
			case "aliyun_bailian":
				return "qwen3.8-flash";
			case "siliconflow":
				return "deepseek-ai/DeepSeek-V4-Flash";
			case "openai":
			default:
				return "gpt-6.1-sol";
		}
	};

	// 切换provider时设置默认值
	const handleProviderChange = (provider: ProviderType) => {
		setFormData((prev) => ({
			...prev,
			provider_type: provider,
			api_base: getDefaultApiBase(provider),
			model: getDefaultModel(provider),
		}));
	};

	if (loading) {
		return (
			<div
				style={{
					display: "flex",
					justifyContent: "center",
					alignItems: "center",
					height: "200px",
				}}
				aria-busy="true"
			>
				<div className="spinner" />
			</div>
		);
	}

	/*
	 * Restyle (spec §20): the settings column is a stack of `.field` groups on
	 * the shared `.input` / `.select` / `.btn` primitives. Every colour below is
	 * a design token — the four legacy literal colours and the alpha tints they
	 * came with are gone. Field order, values and every
	 * onChange handler are untouched: the payload, the 800ms auto-save debounce
	 * and the default provider/model fallbacks all behave exactly as before.
	 */
	return (
		<div
			style={{
				padding: compact ? "var(--space-4)" : "var(--space-6)",
				overflow: "auto",
				height: "100%",
				minWidth: 0,
			}}
		>
			{error && (
				<div
					role="alert"
					style={{
						padding: "var(--space-3) var(--space-4)",
						marginBottom: "var(--space-4)",
						background: "var(--color-error-bg)",
						border: "1px solid var(--color-error)",
						borderRadius: "var(--radius-md)",
						color: "var(--color-error)",
						fontSize: "var(--text-sm)",
					}}
				>
					{error}
				</div>
			)}

			{!agent?.api_key_set && (
				<div
					role="status"
					style={{
						display: "flex",
						alignItems: "center",
						gap: "var(--space-2)",
						padding: "var(--space-3) var(--space-4)",
						marginBottom: "var(--space-4)",
						background: "var(--color-warning-bg)",
						border: "1px solid var(--color-warning)",
						borderRadius: "var(--radius-md)",
						color: "var(--color-warning)",
						fontSize: "var(--text-sm)",
					}}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						aria-hidden="true"
					>
						<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
						<line x1="12" y1="9" x2="12" y2="13" />
						<line x1="12" y1="17" x2="12.01" y2="17" />
					</svg>
					<span>{t("labels.pleaseConfigureApiKey")}</span>
				</div>
			)}

			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: "var(--space-2)",
					minWidth: 0,
				}}
			>
				<div className="field">
					<span className="field-label">
						{t("labels.presetPersona")}
						<HelpTooltip
							title={t("labels.presetPersona")}
							content={[
								t("labels.presetPersonaDesc"),
								t("labels.genericPersona"),
								t("labels.customerServicePersona"),
								t("labels.salesPersona"),
								t("labels.customPersona"),
							]}
							position="top"
							size="xs"
						/>
					</span>
					<select
						className="select"
						aria-label={t("labels.presetPersona")}
						value={selectedPersona}
						onChange={(e) => handlePersonaChange(e.target.value as PersonaType)}
					>
						{PERSONA_TYPES.map((key) => (
							<option key={key} value={key}>
								{key === "general"
									? t("personas.generic.name")
									: key === "customer-service"
										? t("personas.customerService.name")
										: key === "sales"
											? t("personas.sales.name")
											: t("personas.custom.name")}
							</option>
						))}
					</select>
					{selectedPersona === "custom" && (
						<>
							<textarea
								className="input textarea"
								aria-label={t("labels.customPersona")}
								value={formData.system_prompt}
								onChange={(e) => {
									handlePromptChange(e.target.value);
									// 清除错误状态当用户开始输入
									if (e.target.value.trim()) {
										setPersonaError(false);
									}
								}}
								rows={compact ? 4 : 6}
								placeholder={t("placeholders.enterCustomPersona")}
								style={{
									fontFamily: "var(--font-mono)",
									borderColor: personaError
										? "var(--color-error)"
										: "var(--color-border)",
									background: personaError
										? "var(--color-error-bg)"
										: undefined,
								}}
							/>
							{personaError && (
								<span className="field-error">
									{t("errors.customPersonaRequired")}
								</span>
							)}
						</>
					)}
				</div>

				<div className="field">
					<span className="field-label">{t("labels.aiProvider")}</span>
					<select
						className="select"
						aria-label={t("labels.aiProvider")}
						value={formData.provider_type}
						onChange={(e) =>
							handleProviderChange(e.target.value as ProviderType)
						}
					>
						<option value="openai_native">OpenAI (ChatGPT)</option>
						<option value="anthropic">Anthropic (Claude)</option>
						<option value="google">Google (Gemini)</option>
						<option value="xai">xAI (Grok)</option>
						<option value="deepseek">DeepSeek</option>
						<option value="openrouter">OpenRouter</option>
						<option value="zai">z.ai</option>
						<option value="volcengine">{t("labels.volcengine")}</option>
						<option value="moonshot">{t("labels.moonshot")}</option>
						<option value="tencentcloud">{t("labels.tencentcloud")}</option>
						<option value="aliyun_bailian">{t("labels.aliyun_bailian")}</option>
						<option value="siliconflow">
							{t("labels.siliconflow", { defaultValue: "SiliconFlow" })}
						</option>
						<option value="openai">{t("labels.openaiCompatible")}</option>
					</select>
					{formData.provider_type === "siliconflow" && (
						<span className="field-hint">
							{t("labels.siliconflowOfficialSite")}{" "}
							<a
								href={SILICONFLOW_OFFICIAL_URL}
								target="_blank"
								rel="noopener noreferrer"
								style={{
									color: "var(--color-accent-primary)",
									textDecoration: "underline",
								}}
							>
								SiliconFlow
							</a>
						</span>
					)}
				</div>

				{/* API格式选择 - 仅在自定义模式下显示 */}
				{formData.provider_type === "openai" && (
					<div className="field">
						<span className="field-label">{t("labels.apiFormat")}</span>
						<select
							className="select"
							aria-label={t("labels.apiFormat")}
							value={formData.api_format}
							onChange={(e) =>
								setFormData({
									...formData,
									api_format: e.target.value as ApiFormatType,
								})
							}
						>
							<option value="openai">OpenAI</option>
							<option value="openai_compatible">OpenAI Compatible</option>
							<option value="anthropic">Anthropic</option>
							<option value="google">Google (Gemini)</option>
						</select>
					</div>
				)}

				<div className="field">
					<span className="field-label">
						{t("labels.temperature")} ({formData.temperature})
						<HelpTooltip
							title={t("labels.temperature")}
							content={[
								t("labels.temperatureDesc"),
								t("labels.tempTip1"),
								t("labels.tempTip2"),
								t("labels.tempTip3"),
								t("labels.tempAdvice"),
							]}
							position="top"
							size="xs"
						/>
					</span>
					<input
						type="range"
						aria-label={t("labels.temperature")}
						min="0"
						max="2"
						step="0.1"
						value={formData.temperature}
						onChange={(e) =>
							setFormData({
								...formData,
								temperature: parseFloat(e.target.value),
							})
						}
						style={{ width: "100%", padding: 0, border: "none" }}
					/>
				</div>

				<div className="field">
					<span className="field-label">
						{t("labels.topK")} ({formData.top_k})
						<HelpTooltip
							title={t("labels.topK")}
							content={[
								t("labels.topKDesc"),
								t("labels.topKTip1"),
								t("labels.topKTip2"),
								t("labels.topKTip3"),
								t("labels.topKTip4"),
							]}
							position="top"
							size="xs"
						/>
					</span>
					<input
						type="range"
						aria-label={t("labels.topK")}
						min="1"
						max="20"
						step="1"
						value={formData.top_k}
						onChange={(e) =>
							setFormData({ ...formData, top_k: parseInt(e.target.value) })
						}
						style={{ width: "100%", padding: 0, border: "none" }}
					/>
				</div>

				<div className="field">
					<span className="field-label">
						{t("labels.similarityThreshold")} (
						{Math.round(formData.similarity_threshold * 1000)}%)
						<HelpTooltip
							title={t("labels.similarityThreshold")}
							content={[
								t("labels.similarityThresholdDesc", {
									defaultValue:
										"Only include results with score above this threshold. Scores range ~10%-50%, recommended: 10%.",
								}),
								t("labels.similarityThresholdTip1", {
									defaultValue: "0%: return all results",
								}),
								t("labels.similarityThresholdTip2", {
									defaultValue:
										"Higher values: fewer results, higher precision",
								}),
							]}
							position="top"
							size="xs"
						/>
					</span>
					<input
						type="range"
						aria-label={t("labels.similarityThreshold")}
						min="0"
						max="100"
						step="1"
						value={Math.round(formData.similarity_threshold * 1000)}
						onChange={(e) =>
							setFormData({
								...formData,
								similarity_threshold: parseInt(e.target.value) / 1000,
							})
						}
						style={{ width: "100%", padding: 0, border: "none" }}
					/>
				</div>

				<div
					style={{
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						gap: "var(--space-4)",
					}}
				>
					<div className="field">
						<span
							className="field-label"
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								gap: "var(--space-2)",
							}}
						>
							<span>
								{t("labels.apiKey")}
								{agent?.api_key_set && (
									<span
										style={{
											marginLeft: "var(--space-2)",
											color: "var(--color-success)",
											fontSize: "var(--text-xs)",
										}}
									>
										✓ {t("labels.configured")}
									</span>
								)}
							</span>
							{agent?.api_key_set && (
								<button
									type="button"
									className="btn btn-ghost"
									onClick={handleClearAIKey}
									disabled={saving}
									style={{
										minHeight: 0,
										padding: 0,
										fontSize: "var(--text-xs)",
										color: "var(--color-error)",
										textDecoration: "underline",
									}}
								>
									{t("buttons.clear")}
								</button>
							)}
						</span>
						<input
							className="input"
							type="password"
							aria-label={t("labels.apiKey")}
							value={formData.api_key}
							onChange={(e) => {
								setFormData({ ...formData, api_key: e.target.value });
								setApiKeyError(false);
							}}
							placeholder={
								agent?.api_key_set ? t("placeholders.enterNewApiKey") : "sk-..."
							}
							style={
								apiKeyError
									? { borderColor: "var(--color-error)" }
									: undefined
							}
						/>
						{apiKeyError && (
							<span className="field-error">
								{t("errors.aiApiKeyInvalid")}
							</span>
						)}
					</div>

					{/* API Base: 所有服务商都显示 */}
					<div className="field">
						<span className="field-label">{t("labels.apiBase")}</span>
						<input
							className="input"
							type="text"
							aria-label={t("labels.apiBase")}
							value={formData.api_base}
							onChange={(e) =>
								setFormData({ ...formData, api_base: e.target.value })
							}
							placeholder={getDefaultApiBase(formData.provider_type)}
						/>
					</div>
				</div>

				{/* 模型名称单独一行 */}
				<div className="field">
					<span className="field-label">
						{t("labels.modelName")}
						<HelpTooltip
							title={t("labels.modelName")}
							content={[
								t("labels.modelNameDesc"),
								t("labels.modelNamePreferNonThinking"),
								t("labels.modelNameThinkingAdvice"),
							]}
							position="top"
							size="xs"
						/>
					</span>
					<input
						className="input"
						type="text"
						aria-label={t("labels.modelName")}
						value={formData.model}
						onChange={(e) =>
							setFormData({ ...formData, model: e.target.value })
						}
						placeholder={getDefaultModel(formData.provider_type)}
					/>
				</div>

				{/* #44 — quota degradation. Two fields on the same two-column grid
				    as the primary key, so the pair reads as one setting. */}
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						gap: "var(--space-4)",
					}}
				>
					<div className="field">
						<span className="field-label">
							{t("labels.fallbackModel")}
							<HelpTooltip
								title={t("labels.fallbackModel")}
								content={[t("labels.fallbackModelDesc")]}
								position="top"
								size="xs"
							/>
						</span>
						<input
							className="input"
							type="text"
							aria-label={t("labels.fallbackModel")}
							value={formData.fallback_model}
							onChange={(e) =>
								setFormData({
									...formData,
									fallback_model: e.target.value,
								})
							}
							placeholder={getDefaultModel(formData.provider_type)}
						/>
						<span className="field-hint">
							{t("labels.fallbackModelDesc")}
						</span>
					</div>

					<div className="field">
						<span
							className="field-label"
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								gap: "var(--space-2)",
							}}
						>
							<span>{t("labels.fallbackApiKey")}</span>
							{agent?.fallback_api_key_set && (
								<span
									style={{
										color: "var(--color-success)",
										fontSize: "var(--text-xs)",
									}}
								>
									✓ {t("labels.fallbackConfigured")}
								</span>
							)}
						</span>
						<input
							className="input"
							type="password"
							aria-label={t("labels.fallbackApiKey")}
							value={formData.fallback_api_key}
							onChange={(e) =>
								setFormData({
									...formData,
									fallback_api_key: e.target.value,
								})
							}
							placeholder={
								agent?.fallback_api_key_set
									? t("placeholders.enterNewApiKey")
									: "sk-..."
							}
						/>
						<span className="field-hint">
							{t("labels.fallbackApiKeyDesc")}
						</span>
					</div>
				</div>

				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: "var(--space-3)",
						padding: "var(--space-3) var(--space-4)",
						background: "var(--color-bg-tertiary)",
						border: "1px solid var(--color-border)",
						borderRadius: "var(--radius-md)",
					}}
				>
					<div style={{ minWidth: 0 }}>
						<div
							style={{
								fontSize: "var(--text-sm)",
								fontWeight: 500,
								color: "var(--fg-strong)",
							}}
						>
							{t("labels.enableContext")}
						</div>
						<div
							style={{
								fontSize: "var(--text-xs)",
								color: "var(--fg-dim)",
							}}
						>
							{t("labels.conversationContextShort")}
						</div>
					</div>
					<button
						type="button"
						role="switch"
						aria-checked={formData.enable_context}
						aria-label={t("labels.enableContext")}
						onClick={() =>
							setFormData({
								...formData,
								enable_context: !formData.enable_context,
							})
						}
						style={{
							position: "relative",
							flexShrink: 0,
							width: "44px",
							minWidth: "44px",
							height: "24px",
							minHeight: "24px",
							padding: 0,
							borderRadius: "var(--radius-full)",
							border: "1px solid var(--color-border)",
							background: formData.enable_context
								? "var(--color-accent-primary)"
								: "var(--color-bg-primary)",
							cursor: "pointer",
							transition: "background var(--transition-fast)",
						}}
					>
						<span
							style={{
								position: "absolute",
								top: "2px",
								left: formData.enable_context ? "22px" : "2px",
								width: "18px",
								height: "18px",
								borderRadius: "var(--radius-full)",
								background: "var(--color-text-inverse)",
								transition: "left var(--transition-fast)",
							}}
						/>
					</button>
				</div>
			</div>
		</div>
	);
}
