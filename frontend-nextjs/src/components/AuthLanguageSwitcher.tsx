"use client";

import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

/**
 * Two abbreviations, no label (R4). The visible text is the short code; the
 * accessible name stays the full language name, so `ZH` is not announced as
 * "Z H" and a screen-reader user still gets 简体中文 / English.
 */
const languages = [
	{ code: "zh-CN", short: "ZH", label: "简体中文" },
	{ code: "en-US", short: "EN", label: "English" },
];

export function AuthLanguageSwitcher() {
	const { i18n } = useTranslation("auth");
	const pathname = useLocation().pathname;

	if (pathname !== "/login" && pathname !== "/register") {
		return null;
	}

	return (
		<div className="auth-lang-switcher">
			{languages.map((lang) => {
				const active = i18n.language === lang.code;
				return (
					<button
						key={lang.code}
						type="button"
						className="auth-lang-btn"
						data-active={active ? "true" : undefined}
						onClick={() => i18n.changeLanguage(lang.code)}
						aria-pressed={active}
						aria-label={lang.label}
						title={lang.label}
					>
						{lang.short}
					</button>
				);
			})}
		</div>
	);
}
