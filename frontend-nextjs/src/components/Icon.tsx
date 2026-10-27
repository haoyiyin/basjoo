import type { ReactElement } from "react";

/**
 * The single icon registry (R3). There is deliberately no icon dependency:
 * every glyph is an inline path in the shared 20×20 stroke frame. Adding an
 * icon means adding a name here — nothing outside this file may hand-roll an
 * SVG icon for a control.
 */
export const ICON_NAMES = [
	"home",
	"agents",
	"knowledge",
	"settings",
	"dashboard",
	"playground",
	"sessions",
	"plus",
	"close",
	"trash",
	"back",
	"refresh",
	"send",
	"help",
	"more",
	"copy",
	"check",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const ICON_PATHS: Record<IconName, ReactElement> = {
	home: (
		<>
			<rect x="3" y="3" width="7" height="7" rx="1" />
			<rect x="14" y="3" width="7" height="7" rx="1" />
			<rect x="14" y="14" width="7" height="7" rx="1" />
			<rect x="3" y="14" width="7" height="7" rx="1" />
		</>
	),
	agents: (
		<>
			<path d="M12 2v4" />
			<path d="M12 18v4" />
			<rect x="4" y="6" width="16" height="12" rx="3" />
			<path d="M8 12h.01" />
			<path d="M16 12h.01" />
			<path d="M9 16h6" />
		</>
	),
	knowledge: (
		<>
			<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
			<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
			<path d="M9 7h7" />
			<path d="M9 11h7" />
		</>
	),
	settings: (
		<>
			<circle cx="12" cy="12" r="3" />
			<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
		</>
	),
	dashboard: (
		<>
			<path d="M3 3h7v9H3z" />
			<path d="M14 3h7v5h-7z" />
			<path d="M14 12h7v9h-7z" />
			<path d="M3 16h7v5H3z" />
		</>
	),
	playground: (
		<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
	),
	sessions: (
		<>
			<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
			<circle cx="9" cy="7" r="4" />
			<path d="M23 21v-2a4 4 0 0 0-3-3.87" />
			<path d="M16 3.13a4 4 0 0 1 0 7.75" />
		</>
	),
	plus: (
		<>
			<path d="M12 5v14" />
			<path d="M5 12h14" />
		</>
	),
	close: (
		<>
			<path d="M18 6 6 18" />
			<path d="m6 6 12 12" />
		</>
	),
	trash: (
		<>
			<polyline points="3 6 5 6 21 6" />
			<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
		</>
	),
	back: (
		<>
			<path d="M19 12H5" />
			<path d="m12 19-7-7 7-7" />
		</>
	),
	refresh: (
		<>
			<path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
			<path d="M21 3v5h-5" />
		</>
	),
	send: (
		<>
			<path d="m22 2-7 20-4-9-9-4z" />
			<path d="M22 2 11 13" />
		</>
	),
	help: (
		<>
			<circle cx="12" cy="12" r="10" />
			<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
			<path d="M12 17h.01" />
		</>
	),
	more: (
		<>
			<circle cx="12" cy="5" r="1" />
			<circle cx="12" cy="12" r="1" />
			<circle cx="12" cy="19" r="1" />
		</>
	),
	copy: (
		<>
			<rect x="9" y="9" width="12" height="12" rx="2" />
			<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
		</>
	),
	check: <polyline points="20 6 9 17 4 12" />,
};

interface IconProps {
	name: IconName;
	size?: number;
}

export function Icon({ name, size = 20 }: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
			style={{ display: "block" }}
		>
			{ICON_PATHS[name]}
		</svg>
	);
}
