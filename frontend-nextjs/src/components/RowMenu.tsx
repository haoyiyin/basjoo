import {
	CSSProperties,
	ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";

/**
 * Row overflow menu.
 *
 * The list rows live inside `.list` / `.list-frame`, and both carry
 * `overflow: hidden` so the row hairlines stay inside the rounded corner. An
 * absolutely positioned menu inside a row is therefore clipped: measured in a
 * real browser, a 200×150 menu at y=500 against a `ul.list` ending at y=508
 * left exactly 8px visible — invisible on desktop too, for the last row.
 *
 * So the panel is portalled into `document.body` and positioned `fixed` from
 * the trigger's rect, which removes it from the clipping context without
 * giving up the clip. Do not "fix" this by removing `overflow: hidden`.
 */

/** Distance between the trigger and the panel (== var(--space-1)). */
const MENU_GAP = 4;

export interface MenuRect {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

export interface MenuSize {
	width: number;
	height: number;
}

export interface MenuPosition {
	top: number;
	left: number;
}

function clamp(value: number, max: number): number {
	return Math.min(Math.max(value, 0), Math.max(max, 0));
}

/**
 * Viewport-clamped placement for a `position: fixed` menu.
 *
 * Vertically: prefer below the trigger; flip above it when the panel would run
 * past the bottom edge and there is room above; then clamp into the viewport.
 * Horizontally: `end` right-aligns to the trigger, `start` left-aligns, then
 * clamp so the panel never leaves the viewport.
 *
 * Exported because jsdom has no layout engine — this is the measurable half of
 * the contract, the portal is the other.
 */
export function computeMenuPosition(
	trigger: MenuRect,
	menu: MenuSize,
	viewport: MenuSize,
	align: "start" | "end",
): MenuPosition {
	let top = trigger.bottom + MENU_GAP;
	const above = trigger.top - menu.height - MENU_GAP;
	if (top + menu.height > viewport.height && above >= 0) {
		top = above;
	}
	top = clamp(top, viewport.height - menu.height);

	let left = align === "end" ? trigger.right - menu.width : trigger.left;
	left = clamp(left, viewport.width - menu.width);

	return { top, left };
}

/**
 * One guard for every row-level click: a click that lands on a control (menu
 * trigger, a link, a menu item) belongs to that control and must not also
 * trigger the row's own navigation.
 */
export function isRowControl(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false;
	return Boolean(
		target.closest("button, a, [role='menu'], [role='menuitem']"),
	);
}

export interface RowMenuProps {
	/** Accessible name for the menu itself. */
	label: string;
	/** Accessible name for the trigger button. */
	triggerLabel: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** `end` (default) right-aligns the panel to the trigger. */
	align?: "start" | "end";
	triggerTestId?: string;
	menuTestId?: string;
	/** Inline overrides for the trigger, e.g. the 44px mobile hit area. */
	triggerStyle?: CSSProperties;
	children: ReactNode;
}

export default function RowMenu({
	label,
	triggerLabel,
	open,
	onOpenChange,
	align = "end",
	triggerTestId,
	menuTestId,
	triggerStyle,
	children,
}: RowMenuProps) {
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const [position, setPosition] = useState<MenuPosition | null>(null);

	// The listeners below must not re-attach on every parent render just because
	// the callback is inline. The ref keeps the newest one without the churn.
	const onOpenChangeRef = useRef(onOpenChange);
	onOpenChangeRef.current = onOpenChange;

	const updatePosition = useCallback(() => {
		const trigger = triggerRef.current;
		const menu = menuRef.current;
		if (!trigger || !menu) return;
		const triggerRect = trigger.getBoundingClientRect();
		const menuRect = menu.getBoundingClientRect();
		setPosition(
			computeMenuPosition(
				{
					top: triggerRect.top,
					bottom: triggerRect.bottom,
					left: triggerRect.left,
					right: triggerRect.right,
				},
				{
					width: menuRect.width || menu.offsetWidth,
					height: menuRect.height || menu.offsetHeight,
				},
				{ width: window.innerWidth, height: window.innerHeight },
				align,
			),
		);
	}, [align]);

	// Measure once the panel is in the DOM (its size is only known then) and
	// again on scroll/resize: `position: fixed` does not follow the trigger.
	useLayoutEffect(() => {
		if (!open) {
			setPosition(null);
			return;
		}
		updatePosition();
		window.addEventListener("resize", updatePosition);
		window.addEventListener("scroll", updatePosition, true);
		return () => {
			window.removeEventListener("resize", updatePosition);
			window.removeEventListener("scroll", updatePosition, true);
		};
	}, [open, updatePosition]);

	useEffect(() => {
		if (!open) return;
		const close = () => onOpenChangeRef.current(false);
		const handleMouseDown = (event: MouseEvent) => {
			const target = event.target as Node | null;
			if (!target) return;
			if (menuRef.current?.contains(target)) return;
			// The trigger owns its own toggle; closing here would reopen it in the
			// same click.
			if (triggerRef.current?.contains(target)) return;
			close();
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			close();
			triggerRef.current?.focus();
		};
		document.addEventListener("mousedown", handleMouseDown);
		document.addEventListener("keydown", handleKeyDown);
		window.addEventListener("blur", close);
		return () => {
			document.removeEventListener("mousedown", handleMouseDown);
			document.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("blur", close);
		};
	}, [open]);

	return (
		<>
			<button
				type="button"
				ref={triggerRef}
				className="btn btn-icon"
				data-testid={triggerTestId}
				aria-label={triggerLabel}
				aria-haspopup="menu"
				aria-expanded={open}
				style={triggerStyle}
				onClick={() => onOpenChange(!open)}
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 16 16"
					fill="currentColor"
					aria-hidden="true"
				>
					<circle cx="8" cy="3" r="1.4" />
					<circle cx="8" cy="8" r="1.4" />
					<circle cx="8" cy="13" r="1.4" />
				</svg>
			</button>
			{open &&
				createPortal(
					<div
						ref={menuRef}
						role="menu"
						className="row-menu"
						data-testid={menuTestId}
						aria-label={label}
						style={{
							top: position ? position.top : 0,
							left: position ? position.left : 0,
							// The first frame has no measurement yet; keep it out of the a11y
							// tree and out of sight until the position is known.
							visibility: position ? "visible" : "hidden",
						}}
						onClick={(event) => {
							const target = event.target as HTMLElement;
							if (!target.closest("[role='menuitem']")) return;
							onOpenChange(false);
							triggerRef.current?.focus();
						}}
					>
						{children}
					</div>,
					document.body,
				)}
		</>
	);
}
