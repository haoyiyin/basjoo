"use client";

import { useTranslation } from "react-i18next";
import AdminLayout from "../components/AdminLayout";

/**
 * Workspace home (spec §14). The user emptied this page on purpose: it is a
 * page title and nothing else — no cards, no stats, no "coming soon" copy.
 * It fetches nothing and holds no state.
 *
 * The root keeps the `admin-page` contract every other admin view uses, so the
 * 375px layout suite can assert it like any sibling page.
 */
export default function Home() {
	const { t } = useTranslation("common");

	return (
		<AdminLayout>
			<div className="admin-page" data-testid="home-page">
				<header className="page-header">
					<h1 className="page-title">{t("home.title")}</h1>
				</header>
			</div>
		</AdminLayout>
	);
}
