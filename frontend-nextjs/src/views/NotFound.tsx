import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

/**
 * Catch-all page for a URL that matches no route.
 *
 * Before this view existed an unknown path mounted nothing at all: the SPA
 * shell rendered an empty `<body>`, so a typo or a stale bookmark looked like a
 * crash. It is deliberately layout-free — the same component is mounted inside
 * the auth layout group and inside the authed `DashboardLayout` group, so it
 * only owns the page surface and the way back.
 */
export default function NotFound(): ReactElement {
	const { t } = useTranslation("common");

	return (
		<div className="admin-page" data-testid="not-found-page">
			<header className="page-header">
				<h1 className="page-title">{t("notFound.title")}</h1>
			</header>
			<div className="empty">
				<p className="empty-description">{t("notFound.body")}</p>
				<div className="empty-actions">
					<Link to="/" className="btn btn-primary">
						{t("notFound.back")}
					</Link>
				</div>
			</div>
		</div>
	);
}
