#!/usr/bin/env node
/**
 * Generate `frontend-nextjs/src/design/widgetTheme.ts` from the widget's own
 * token mirror, `widget/src/theme.ts`.
 *
 * Why a copy and not an import: the SPA is built and served from a container
 * that mounts ONLY `frontend-nextjs` (docker-compose `frontend-dev`:
 * `./frontend-nextjs:/app`), and the production Dockerfile copies only the SPA
 * package. `widget/` is a sibling of the SPA package, so a relative
 * `../../../widget/src/theme` import — or a Vite alias pointing at it —
 * resolves in tsc and vitest but is *absent at runtime*, which is exactly the
 * blank-page failure this replaces.
 *
 * This script therefore lives inside the package (`frontend-nextjs/scripts`)
 * so the image always has it; when `widget/` is not on disk it prints that and
 * leaves the committed copy alone.
 *
 * The copy is byte-identical below the header, and `backend/tests/
 * test_widget_palette.py` asserts that, so the two can never drift silently.
 * `widget/src/theme.ts` remains the single source of truth: edit it, never the
 * generated file.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const spaRoot = resolve(here, '..');
const repoRoot = resolve(spaRoot, '..');

const SOURCE = resolve(repoRoot, 'widget/src/theme.ts');
const TARGET = resolve(spaRoot, 'src/design/widgetTheme.ts');

const HEADER = `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source: \`widget/src/theme.ts\` (run \`npm run sync-widget-theme\` to refresh).
 *
 * This is the widget's mirror of \`frontend-nextjs/src/index.css\`, copied into
 * the SPA package because the SPA's dev container and production image do not
 * contain \`widget/\`. \`backend/tests/test_widget_palette.py\` asserts this file
 * is byte-identical to the source apart from this header, so the preview and
 * the shipped widget cannot drift.
 */

`;

let source;
try {
	source = readFileSync(SOURCE, 'utf8');
} catch {
	// The production image and the dev container mount only `frontend-nextjs`,
	// so the widget source is not on disk there. The generated file is
	// committed, so building from it is correct — but never silently: say so,
	// and fail only if there is nothing to build from at all.
	try {
		readFileSync(TARGET, 'utf8');
		console.log(
			'widget/src/theme.ts not present in this checkout (SPA-only image); ' +
				'using the committed widgetTheme.ts',
		);
		process.exit(0);
	} catch {
		console.error(
			'Cannot generate widgetTheme.ts: widget/src/theme.ts is absent and ' +
				'no committed copy exists at ' +
				TARGET,
		);
		process.exit(1);
	}
}

const generated = HEADER + source;

mkdirSync(dirname(TARGET), { recursive: true });

let previous = null;
try {
	previous = readFileSync(TARGET, 'utf8');
} catch {
	// First run — nothing to compare against.
}

if (previous === generated) {
	console.log('widgetTheme.ts already up to date');
} else {
	writeFileSync(TARGET, generated);
	console.log(`widgetTheme.ts regenerated from widget/src/theme.ts (${generated.length} bytes)`);
}
