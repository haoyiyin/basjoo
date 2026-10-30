"use client";

import { useRef, useEffect, memo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Source, UsageInfo } from "../services/api";
import { formatAssistantMessageContent } from "../utils/citations";
import { useIsMobile } from "../hooks/useMediaQuery";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { Icon } from "./Icon";

export interface Message {
	clientId?: number;
	role: "user" | "assistant";
	content: string;
	sources?: Source[];
	usage?: UsageInfo;
	isStreaming?: boolean;
	thinkingElapsed?: number;
	/** #44: this answer came from the agent's fallback model. */
	degraded?: boolean;
	/** #44: the model that produced the answer (shown with the notice). */
	model?: string | null;
	timestamp: Date;
}

export interface Agent {
	id?: string;
	name: string;
	model: string;
	temperature: number;
	max_tokens: number;
	system_prompt: string;
}

interface ChatPanelProps {
	messages: Message[];
	input: string;
	isLoading: boolean;
	isSettingsSaving?: boolean;
	sendDisabled?: boolean;
	agent: Agent | null;
	onInputChange: (value: string) => void;
	onSendMessage: () => void;
	onClearChat: () => void;
}

/*
 * Shared chat surface (spec §20). Used by Playground and by the admin chat
 * screen, so this file is a restyle only: the props contract, the streamed
 * message shapes and the `data-testid` hooks (`chat-messages`,
 * `message-bubble`, `chat-message-input`) are unchanged.
 *
 * Colour rule: every fill/stroke below resolves to a design token — the chat
 * pane has no literal hex and no alpha-tinted glass, so it reads the same in
 * both themes.
 */

const streamingCursorStyle: React.CSSProperties = {
	display: "inline-block",
	width: "0.5rem",
	height: "1em",
	verticalAlign: "text-bottom",
	background: "var(--color-accent-primary)",
	animation: "blinkCursor 1s steps(1) infinite",
};

const metaTagStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "var(--space-2)",
	minWidth: 0,
	padding: "2px var(--space-2)",
	fontSize: "var(--text-xs)",
	lineHeight: "var(--leading-snug)",
	color: "var(--fg-default)",
	background: "var(--color-bg-tertiary)",
	border: "1px solid var(--color-border)",
	borderRadius: "var(--radius-full)",
};

function StreamingCursor({ marginLeft }: { marginLeft?: string }) {
	return (
		<span
			style={
				marginLeft
					? { ...streamingCursorStyle, marginLeft }
					: streamingCursorStyle
			}
		/>
	);
}

// Loading dots animation
function LoadingDots() {
	return (
		<div style={{ display: "flex", gap: "var(--space-1)", alignItems: "center" }}>
			<span
				style={{
					width: "6px",
					height: "6px",
					borderRadius: "var(--radius-full)",
					background: "var(--color-accent-primary)",
					animation: "bounce 1.4s ease-in-out 0s infinite both",
				}}
			/>
			<span
				style={{
					width: "6px",
					height: "6px",
					borderRadius: "var(--radius-full)",
					background: "var(--color-accent-primary)",
					animation: "bounce 1.4s ease-in-out 0.16s infinite both",
				}}
			/>
			<span
				style={{
					width: "6px",
					height: "6px",
					borderRadius: "var(--radius-full)",
					background: "var(--color-accent-primary)",
					animation: "bounce 1.4s ease-in-out 0.32s infinite both",
				}}
			/>
		</div>
	);
}

function ReferenceList({
	references,
}: {
	references: Array<{ title: string; url: string }>;
}) {
	const { t } = useTranslation("common");

	if (references.length === 0) {
		return null;
	}

	return (
		<div
			style={{
				marginTop: "var(--space-3)",
				paddingTop: "var(--space-3)",
				borderTop: "1px solid var(--color-border)",
			}}
		>
			<div
				style={{
					fontSize: "var(--text-xs)",
					fontWeight: 600,
					color: "var(--fg-dim)",
					marginBottom: "var(--space-2)",
				}}
			>
				{t("citations.references")}
			</div>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: "var(--space-2)",
				}}
			>
				{references.map((reference) => (
					<a
						key={reference.url}
						href={reference.url}
						target="_blank"
						rel="noopener noreferrer"
						style={{
							color: "var(--color-accent-primary)",
							fontSize: "var(--text-sm)",
							fontWeight: 500,
							wordBreak: "break-word",
						}}
					>
						{reference.title}
					</a>
				))}
			</div>
		</div>
	);
}

function ChatPanel({
	messages,
	input,
	isLoading,
	isSettingsSaving = false,
	sendDisabled = false,
	agent,
	onInputChange,
	onSendMessage,
	onClearChat,
}: ChatPanelProps) {
	const { t } = useTranslation("common");
	const isMobile = useIsMobile();
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const [agentIdCopied, setAgentIdCopied] = useState(false);
	// MobileLayout idiom: icon-only controls become >= 44px tap targets.
	const iconButtonStyle = isMobile
		? { minWidth: 44, minHeight: 44 }
		: undefined;

	const handleCopyAgentId = async () => {
		if (!agent?.id) {
			return;
		}
		try {
			await navigator.clipboard.writeText(agent.id);
		} catch {
			const textArea = document.createElement("textarea");
			textArea.value = agent.id;
			document.body.appendChild(textArea);
			textArea.select();
			document.execCommand("copy");
			document.body.removeChild(textArea);
		}
		setAgentIdCopied(true);
		window.setTimeout(() => setAgentIdCopied(false), 2000);
	};

	// Scroll to bottom when messages change
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	const sendBlocked =
		isLoading || isSettingsSaving || sendDisabled || !input.trim();

	return (
		<div
			style={{
				flex: 1,
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
				height: "100%",
				minWidth: 0,
			}}
		>
			{/* Agent info bar: one row of meta pills, no container chrome. */}
			{agent && (
				<div
					style={{
						display: "flex",
						flexWrap: "wrap",
						gap: "var(--space-2)",
						alignItems: "center",
						padding: "var(--space-2) var(--space-4)",
						borderBottom: "1px solid var(--color-border)",
						background: "var(--surface-bg)",
						flexShrink: 0,
					}}
				>
					<span style={metaTagStyle}>
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							aria-hidden="true"
							style={{ color: "var(--color-accent-primary)" }}
						>
							<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
							<path d="M19 10v2a7 7 0 0 1-14 0v-2" />
							<line x1="12" y1="19" x2="12" y2="23" />
							<line x1="8" y1="23" x2="16" y2="23" />
						</svg>
						<span style={{ color: "var(--fg-dim)" }}>
							{t("playground.agent")}
						</span>
						<span style={{ color: "var(--fg-strong)", fontWeight: 500 }}>
							{agent.name}
						</span>
					</span>

					<span
						style={{
							...metaTagStyle,
							background: "var(--color-accent-bg)",
							border: "1px solid var(--color-accent-primary)",
							color: "var(--color-accent-primary)",
						}}
					>
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							aria-hidden="true"
						>
							<rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
							<line x1="8" y1="21" x2="16" y2="21" />
							<line x1="12" y1="17" x2="12" y2="21" />
						</svg>
						<span style={{ fontWeight: 500 }}>{agent.model}</span>
					</span>

					<span style={metaTagStyle}>
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							aria-hidden="true"
							style={{ color: "var(--color-warning)" }}
						>
							<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
						</svg>
						<span style={{ color: "var(--fg-dim)" }}>
							{t("playground.temperature")}
						</span>
						<span style={{ color: "var(--fg-strong)", fontWeight: 500 }}>
							{agent.temperature}
						</span>
					</span>

					{agent.id && (
						<button
							type="button"
							onClick={handleCopyAgentId}
							aria-label={`${t("buttons.copy")} ${t("labels.agentId")}`}
							title={agentIdCopied ? t("status.success") : t("buttons.copy")}
							style={{
								...metaTagStyle,
								cursor: "pointer",
								color: agentIdCopied
									? "var(--color-success)"
									: "var(--fg-dim)",
								fontFamily: "var(--font-mono)",
							}}
						>
							<span>{t("labels.agentId")}</span>
							<span style={{ color: "var(--fg-strong)", fontWeight: 500 }}>
								{agent.id}
							</span>
						</button>
					)}
				</div>
			)}

			{/* Messages area: no fill of its own (#32). The bubbles, the meta bar and
			 * the composer carry their own surfaces; a page-sized rectangle behind
			 * them only added a second background. */}
			<div
				data-testid="chat-messages"
				style={{
					flex: 1,
					minHeight: 0,
					overflow: "auto",
					padding: "var(--space-4)",
				}}
				aria-live="polite"
			>
				{messages.length === 0 ? (
					<div
						style={{
							height: "100%",
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							justifyContent: "center",
							textAlign: "center",
							gap: "var(--space-2)",
						}}
					>
						<div
							style={{
								width: "56px",
								height: "56px",
								background: "var(--color-bg-tertiary)",
								borderRadius: "var(--radius-lg)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								marginBottom: "var(--space-2)",
								border: "1px solid var(--color-border)",
							}}
						>
							<svg
								width="28"
								height="28"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								aria-hidden="true"
								style={{ color: "var(--color-accent-primary)" }}
							>
								<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
							</svg>
						</div>
						<p className="empty-title">{t("playground.startChat")}</p>
						<p className="empty-description">{t("playground.startChatHint")}</p>
					</div>
				) : (
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: "var(--space-4)",
						}}
					>
						{messages.map((msg, idx) => {
							const formattedAssistantContent =
								msg.role === "assistant"
									? formatAssistantMessageContent(msg.content, msg.sources)
									: null;

							return (
								<div
									key={msg.clientId ?? idx}
									data-testid="message-bubble"
									data-role={msg.role}
									style={{
										display: "flex",
										justifyContent:
											msg.role === "user" ? "flex-end" : "flex-start",
										animation: "fadeIn 0.3s ease-out forwards",
									}}
								>
									<div
										style={{
											maxWidth: "85%",
											minWidth: 0,
											display: "flex",
											flexDirection: "column",
											gap: "var(--space-1)",
											alignItems:
												msg.role === "user" ? "flex-end" : "flex-start",
										}}
									>
										{/* Message bubble */}
										<div
											style={{
												padding: "var(--space-3) var(--space-4)",
												borderRadius: "var(--radius-lg)",
												background:
													msg.role === "user"
														? "var(--color-accent-primary)"
														: "var(--color-bg-elevated)",
												color:
													msg.role === "user"
														? "var(--color-text-inverse)"
														: "var(--fg-strong)",
												border:
													msg.role === "assistant"
														? "1px solid var(--color-border)"
														: "none",
												boxShadow: "var(--shadow-sm)",
											}}
										>
											<div
												style={{
													fontSize: "var(--text-sm)",
													lineHeight: "var(--leading-relaxed)",
													minWidth: 0,
												}}
											>
												{msg.role === "assistant" ? (
													<div>
														{msg.isStreaming &&
														!msg.content &&
														typeof msg.thinkingElapsed === "number" ? (
															<div
																style={{
																	display: "flex",
																	alignItems: "center",
																	gap: "var(--space-2)",
																}}
															>
																<LoadingDots />
																<span style={{ color: "var(--fg-dim)" }}>
																	{typeof msg.thinkingElapsed === "number"
																		? `${t("status.thinking")} ${msg.thinkingElapsed}s`
																		: t("status.thinking")}
																</span>
															</div>
														) : msg.isStreaming && !msg.content ? (
															<StreamingCursor />
														) : (
															<>
																{msg.isStreaming ? (
																	<div
																		style={{
																			whiteSpace: "pre-wrap",
																			wordBreak: "break-word",
																		}}
																	>
																		{msg.content}
																	</div>
																) : (
																	<>
																		<MarkdownRenderer
																			content={
																				formattedAssistantContent?.content ??
																				msg.content
																			}
																		/>
																		<ReferenceList
																			references={
																				formattedAssistantContent?.references ??
																				[]
																			}
																		/>
																	</>
																)}
																{msg.isStreaming && (
																	<StreamingCursor marginLeft="0.15rem" />
																)}
															</>
														)}
													</div>
												) : (
													<div
														style={{
															whiteSpace: "pre-wrap",
															wordBreak: "break-word",
														}}
													>
														{msg.content}
													</div>
												)}
											</div>
										</div>

										{/* #44: the daily allowance was spent, so the
										    fallback model answered. One line, tokens only. */}
										{msg.role === "assistant" && msg.degraded && (
											<div
												style={{
													padding: "0 var(--space-1)",
													fontSize: "var(--text-xs)",
													lineHeight: "var(--leading-snug)",
													color: "var(--fg-dim)",
												}}
											>
												{t('chat.degradedNotice')}
												{msg.model ? ` · ${msg.model}` : ''}
											</div>
										)}

										{/* Token usage (assistant messages only) */}
										{msg.role === "assistant" && msg.usage && (
											<div
												style={{
													display: "flex",
													alignItems: "center",
													gap: "var(--space-3)",
													padding: "0 var(--space-1)",
													fontSize: "var(--text-xs)",
													color: "var(--fg-dim)",
												}}
											>
												<span
													style={{
														display: "flex",
														alignItems: "center",
														gap: "var(--space-1)",
													}}
												>
													<svg
														width="10"
														height="10"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														strokeWidth="2"
														aria-hidden="true"
													>
														<polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
													</svg>
													{msg.usage.total_tokens} tokens
												</span>
											</div>
										)}
									</div>
								</div>
							);
						})}

						{/* Loading state */}
						{isLoading && !messages.some((message) => message.isStreaming) && (
							<div
								style={{
									display: "flex",
									justifyContent: "flex-start",
								}}
							>
								<div
									style={{
										padding: "var(--space-3) var(--space-4)",
										background: "var(--color-bg-elevated)",
										borderRadius: "var(--radius-lg)",
										border: "1px solid var(--color-border)",
										borderLeft: "3px solid var(--color-accent-primary)",
										display: "flex",
										alignItems: "center",
										gap: "var(--space-3)",
										boxShadow: "var(--shadow-sm)",
									}}
								>
									<LoadingDots />
									<span
										style={{
											color: "var(--fg-dim)",
											fontSize: "var(--text-sm)",
										}}
									>
										{t("status.thinking")}
									</span>
								</div>
							</div>
						)}
						<div ref={messagesEndRef} />
					</div>
				)}
			</div>

			{/* Composer */}
			<div
				style={{
					display: "flex",
					gap: "var(--space-2)",
					alignItems: "stretch",
					flexWrap: "wrap",
					padding: "var(--space-3) var(--space-4)",
					borderTop: "1px solid var(--color-border)",
					background: "var(--surface-bg)",
					flexShrink: 0,
				}}
			>
				<div style={{ flex: 1, minWidth: 0, position: "relative" }}>
					<input
						type="text"
						className="input"
						data-testid="chat-message-input"
						aria-label={t("playground.inputPlaceholder")}
						value={input}
						onChange={(e) => onInputChange(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.nativeEvent.isComposing) {
								e.preventDefault();
								onSendMessage();
							}
						}}
						placeholder={
							isSettingsSaving
								? t("status.saving")
								: t("playground.inputPlaceholder")
						}
						disabled={isLoading || isSettingsSaving}
						style={{ paddingRight: "var(--space-10)" }}
					/>
					{input.length > 0 && (
						<button
							type="button"
							className="btn btn-icon"
							onClick={() => onInputChange("")}
							aria-label={t("buttons.clear")}
							title={t("buttons.clear")}
							style={{
								position: "absolute",
								right: "var(--space-2)",
								top: "50%",
								transform: "translateY(-50%)",
								width: "24px",
								minWidth: "24px",
								height: "24px",
								minHeight: "24px",
							}}
						>
							<Icon name="close" size={12} />
						</button>
					)}
				</div>
				<button
					type="button"
					onClick={onClearChat}
					aria-label={t("buttons.clear")}
					title={t("buttons.clear")}
					className="btn btn-icon"
					style={iconButtonStyle}
				>
					<Icon name="trash" size={18} />
				</button>
				<button
					type="button"
					onClick={onSendMessage}
					aria-label={t("buttons.send")}
					title={t("buttons.send")}
					disabled={sendBlocked}
					className="btn btn-primary btn-icon"
					style={iconButtonStyle}
				>
					{isSettingsSaving ? (
						<span className="spinner" />
					) : (
						<Icon name="send" size={16} />
					)}
				</button>
			</div>

			{/* Animations */}
			<style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes bounce {
          0%, 80%, 100% {
            transform: scale(0.6);
            opacity: 0.5;
          }
          40% {
            transform: scale(1);
            opacity: 1;
          }
        }

        @keyframes blinkCursor {
          0%, 50% {
            opacity: 1;
          }
          50.01%, 100% {
            opacity: 0;
          }
        }
      `}</style>
		</div>
	);
}

export default memo(ChatPanel);
