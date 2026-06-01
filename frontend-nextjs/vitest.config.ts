import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			// In tests, use the real react-router-dom (not the Next.js shim)
			"react-router-dom": path.resolve(
				__dirname,
				"node_modules/react-router-dom",
			),
			"@": path.resolve(__dirname),
		},
	},
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./tests/setup.ts"],
		typecheck: {
			tsconfig: "./tsconfig.test.json",
		},
	},
});
