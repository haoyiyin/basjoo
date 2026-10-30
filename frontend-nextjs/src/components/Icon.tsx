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
	"unlink",
	"trash",
	"back",
	"refresh",
	"send",
	"help",
	"more",
	"copy",
	"check",
	"save",
	"edit",
	"search",
	"filter",
	"download",
	"upload",
	"link",
	"stop",
	"play",
	"eye",
	"eye-off",
	"chevron-down",
	"chevron-up",
	"chevron-left",
	"chevron-right",
	"external-link",
	"clock",
	"user",
	"user-x",
	"check-circle",
	"rotate-ccw",
	"reply",
	"key",
	"logout",
	"alert",
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
	unlink: (
		<>
			<path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
			<path d="m5.17 11.75-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71" />
			<path d="M8 2v3" />
			<path d="M2 8h3" />
			<path d="M16 22v-3" />
			<path d="M22 16h-3" />
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
	save: (
		<>
			<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
			<polyline points="17 21 17 13 7 13 7 21" />
			<polyline points="7 3 7 8 15 8" />
		</>
	),
	edit: (
		<>
			<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
			<path d="m15 5 4 4" />
		</>
	),
	search: (
		<>
			<circle cx="11" cy="11" r="8" />
			<path d="m21 21-4.3-4.3" />
		</>
	),
	filter: <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />,
	download: (
		<>
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<polyline points="7 10 12 15 17 10" />
			<path d="M12 15V3" />
		</>
	),
	upload: (
		<>
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<polyline points="17 8 12 3 7 8" />
			<path d="M12 3v12" />
		</>
	),
	link: (
		<>
			<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
			<path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
		</>
	),
	stop: <rect x="5" y="5" width="14" height="14" rx="2" />,
	play: <polygon points="6 3 20 12 6 21 6 3" />,
	eye: (
		<>
			<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
			<circle cx="12" cy="12" r="3" />
		</>
	),
	"eye-off": (
		<>
			<path d="M9.9 5.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.8 17.8 0 0 1-3.3 4.3" />
			<path d="M6.6 6.6A17.8 17.8 0 0 0 2 12s3.5 7 10 7a10.9 10.9 0 0 0 4.5-1" />
			<path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
			<path d="m2 2 20 20" />
		</>
	),
	"chevron-down": <path d="m6 9 6 6 6-6" />,
	"chevron-up": <path d="m18 15-6-6-6 6" />,
	"chevron-left": <path d="m15 18-6-6 6-6" />,
	"chevron-right": <path d="m9 18 6-6-6-6" />,
	"external-link": (
		<>
			<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
			<polyline points="15 3 21 3 21 9" />
			<path d="M10 14 21 3" />
		</>
	),
	clock: (
		<>
			<circle cx="12" cy="12" r="10" />
			<polyline points="12 6 12 12 16 14" />
		</>
	),
	user: (
		<>
			<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
			<circle cx="12" cy="7" r="4" />
		</>
	),
	"user-x": (
		<>
			<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
			<circle cx="12" cy="7" r="4" />
			<path d="m17 8 5 5" />
			<path d="m22 8-5 5" />
		</>
	),
	"check-circle": (
		<>
			<path d="M21.8 10A10 10 0 1 1 17 3.3" />
			<polyline points="22 4 12 14.01 9 11.01" />
		</>
	),
	"rotate-ccw": (
		<>
			<path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
			<polyline points="3 3 3 8 8 8" />
		</>
	),
	reply: (
		<>
			<polyline points="9 17 4 12 9 7" />
			<path d="M20 18v-2a4 4 0 0 0-4-4H4" />
		</>
	),
	key: (
		<>
			<circle cx="7.5" cy="15.5" r="5.5" />
			<path d="m21 2-9.6 9.6" />
			<path d="m15.5 7.5 3 3L22 7l-3-3" />
		</>
	),
	logout: (
		<>
			<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
			<polyline points="16 17 21 12 16 7" />
			<path d="M21 12H9" />
		</>
	),
	alert: (
		<>
			<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
			<path d="M12 9v4" />
			<path d="M12 17h.01" />
		</>
	),
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
