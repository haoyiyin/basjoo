import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname),
		},
	},
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./tests/setup.ts"],
		// Several jsdom route tests mock browser globals such as localStorage,
		// fetch, matchMedia, and react-i18next. Running files in parallel makes
		// those global mocks flaky under Vitest workers, so keep unit tests serial.
		maxWorkers: 1,
		typecheck: {
			tsconfig: "./tsconfig.json",
		},
	},
});
