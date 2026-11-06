/**
 * #71/#75 — an attachment upload must not outlive the conversation it started in.
 *
 * Defect: an upload POST is async. If the visitor resets the conversation
 * (New chat / End chat / identity change) while the POST is outstanding, the
 * late response used to be applied to whatever conversation existed when it
 * landed — adopting the closed session (the request carried it) or pushing a
 * chip into the fresh one. The stale turn then referenced ids that belong to a
 * different session, or resurrected a session the operator closed.
 *
 * Fix: every upload batch captures the conversation epoch when it is picked;
 * a reset bumps the epoch, so a late response is discarded (success OR
 * failure) instead of adopting or contaminating the new conversation.
 *
 * `fetch` is stubbed: what is pinned here is the widget's own client contract.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import './BasjooWidget';

interface WidgetLike {
	init(): Promise<void>;
	destroy(): void;
	sessionId: string | null;
	identify(identity: null | { email: string; hash: string }): void;
}

type WidgetConstructor = new (config: {
	agentId: string;
	apiBase?: string;
	language?: string;
}) => WidgetLike;

interface Call {
	url: string;
	body?: unknown;
	method?: string;
}

const CONFIG = {
	widget_title: 'Support',
	widget_color: '#F9CA02',
	welcome_message: 'Hi',
	online: true,
};

function jsonResponse(body: unknown, status = 200, jsonDelayMs = 0): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => {
			if (jsonDelayMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, jsonDelayMs));
			}
			return body;
		},
		text: async () => JSON.stringify(body),
	} as unknown as Response;
}

function sseResponse(events: string[]): Response {
	const body = events.map((event) => `${event}\n\n`).join('');
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode(body));
			controller.close();
		},
	});
	return {
		ok: true,
		status: 200,
		body: stream,
		json: async () => ({}),
		text: async () => body,
	} as unknown as Response;
}

/**
 * Stub fetch. The attachment POST echoes the `session_id` it was given (the
 * widget always sends the current one when it has a session) and returns it in
 * the payload — exactly the shape that used to be adopted after a reset.
 * `uploadDelayMs` keeps the POST outstanding so a reset can overlap it.
 */
function installFetch(options: { uploadDelayMs?: number; uploadStatus?: number; uploadDetail?: string; jsonDelayMs?: number; hangFirstUpload?: boolean; stallBodyUntilAbort?: boolean } = {}) {
	const calls: Call[] = [];
	const { uploadDelayMs = 0, uploadStatus = 200, uploadDetail = 'rejected', jsonDelayMs = 0, hangFirstUpload = false, stallBodyUntilAbort = false } = options;
	let uploadCounter = 0;
	let uploadHits = 0;
	let streamCounter = 0;

	const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		let body: unknown;
		if (typeof init?.body === 'string') {
			body = JSON.parse(init.body);
		} else if (init?.body instanceof FormData) {
			body = { __formData: true, hasFile: init.body.has('file') };
		}
		calls.push({ url, body, method: init?.method });

		if (url.includes('/api/v1/config:public')) return jsonResponse(CONFIG);
		if (url.includes('/api/v1/chat/attachments')) {
			uploadHits += 1;
			// The first upload resolves its headers immediately but never settles
			// its body on its own; only aborting the request rejects `json()`,
			// exactly like a real fetch body cancelled after the response head.
			if (stallBodyUntilAbort && uploadHits === 1) {
				return {
					ok: true,
					status: 200,
					json: () =>
						new Promise<unknown>((_resolve, reject) => {
							const fail = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
							if (init?.signal?.aborted) {
								fail();
								return;
							}
							init?.signal?.addEventListener('abort', fail);
						}),
					text: async () => '',
				} as unknown as Response;
			}
			// The first upload never settles on its own; it only rejects when
			// aborted, mirroring real fetch under an AbortSignal.
			if (hangFirstUpload && uploadHits === 1) {
				return await new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => {
						reject(new DOMException('The operation was aborted.', 'AbortError'));
					});
				});
			}
			if (uploadDelayMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, uploadDelayMs));
			}
			if (uploadStatus !== 200) {
				return jsonResponse({ detail: uploadDetail }, uploadStatus, jsonDelayMs);
			}
			uploadCounter += 1;
			const requestedSession = new URL(url).searchParams.get('session_id');
			return jsonResponse({
				id: `att_${uploadCounter}`,
				filename: `file-${uploadCounter}.txt`,
				mime: 'text/plain',
				kind: 'document',
				status: 'uploaded',
				session_id: requestedSession,
			});
		}
		if (url.includes('/api/v1/chat/session:end')) {
			return jsonResponse({ success: true, session_id: 'sess_1', status: 'closed', closed_by: 'visitor' });
		}
		if (url.includes('/api/v1/chat/session:current')) {
			return jsonResponse({ session_id: null });
		}
		if (url.includes('/api/v1/chat/stream')) {
			streamCounter += 1;
			return sseResponse([
				'event: sources\ndata: {"sources": []}',
				'event: content\ndata: {"content": "Got it."}',
				`event: done\ndata: {"message_id": ${streamCounter}, "session_id": "sess_${streamCounter}", "mode": "ai"}`,
			]);
		}
		if (url.includes('/api/v1/chat/messages')) return jsonResponse([]);
		return jsonResponse({}, 404);
	});

	vi.stubGlobal('fetch', fetchMock);
	return calls;
}

function makeWidget(language = 'en-US'): WidgetLike {
	const BasjooWidget = (window as unknown as { BasjooWidget: WidgetConstructor }).BasjooWidget;
	return new BasjooWidget({ agentId: 'agent-1', apiBase: 'http://localhost:8000', language });
}

function menuToggle(): HTMLButtonElement {
	return document.querySelector('.basjoo-menu-toggle') as HTMLButtonElement;
}

function newChatBtn(): HTMLButtonElement {
	return document.querySelector('.basjoo-new-chat') as HTMLButtonElement;
}

function endChatBtn(): HTMLButtonElement {
	return document.querySelector('.basjoo-end-chat') as HTMLButtonElement;
}

function input(): HTMLInputElement {
	return document.querySelector('.basjoo-input') as HTMLInputElement;
}

function sendBtn(): HTMLButtonElement {
	return document.querySelector('.basjoo-send') as HTMLButtonElement;
}

function pick(files: File[]): void {
	const el = document.querySelector('.basjoo-file-input') as HTMLInputElement;
	Object.defineProperty(el, 'files', { value: files, writable: true, configurable: true });
	el.dispatchEvent(new Event('change'));
}

function makeFile(name: string, bytes = 10, type = 'text/plain'): File {
	return new File([new Uint8Array(bytes)], name, { type });
}

function chips(): HTMLElement[] {
	return Array.from(document.querySelectorAll('.basjoo-attachment')) as HTMLElement[];
}

function errors(): Array<string | null> {
	return Array.from(document.querySelectorAll('.basjoo-error')).map((el) => el.textContent);
}

async function sendOne(text = 'hello'): Promise<void> {
	input().value = text;
	sendBtn().click();
	await new Promise((resolve) => setTimeout(resolve, 60));
}

function streamCalls(calls: Call[]): Call[] {
	return calls.filter((call) => call.url.includes('/api/v1/chat/stream'));
}

describe('BasjooWidget stale uploads across a conversation reset (#71/#75)', () => {
	beforeEach(() => {
		document.documentElement.innerHTML = '<html><head></head><body></body></html>';
		window.localStorage.clear();
		window.localStorage.setItem('basjoo_visitor_id', 'visitor_test');
	});

	afterEach(() => {
		document.querySelectorAll('#basjoo-widget-container').forEach((el) => el.remove());
		document.querySelectorAll('#basjoo-widget-styles').forEach((el) => el.remove());
		vi.unstubAllGlobals();
	});

	it('discards an upload that lands after New chat instead of resurrecting the old session', async () => {
		const calls = installFetch({ uploadDelayMs: 60 });
		const widget = makeWidget('en-US');
		await widget.init();
		await sendOne('first turn');
		expect(widget.sessionId).toBe('sess_1');

		pick([makeFile('stale.txt')]);
		await new Promise((resolve) => setTimeout(resolve, 10));

		menuToggle().click();
		newChatBtn().click();
		expect(widget.sessionId).toBeNull();
		expect(window.localStorage.getItem('basjoo_session_agent-1')).toBeNull();

		// Let the stale upload settle against the now-reset conversation.
		await new Promise((resolve) => setTimeout(resolve, 150));

		expect(widget.sessionId, 'the old session must never be adopted again').toBeNull();
		expect(window.localStorage.getItem('basjoo_session_agent-1')).toBeNull();
		expect(chips(), 'no chip may contaminate the new conversation').toHaveLength(0);

		// A fresh turn is a fresh session and carries no stale attachment id.
		await sendOne('second turn');
		const streams = streamCalls(calls);
		expect(streams).toHaveLength(2);
		expect((streams[1].body as { attachment_ids?: string[] }).attachment_ids ?? []).toEqual([]);

		widget.destroy();
	});

	it('discards an upload that lands after End chat instead of adopting the closed session', async () => {
		installFetch({ uploadDelayMs: 60 });
		const widget = makeWidget('en-US');
		await widget.init();
		await sendOne('first turn');
		expect(widget.sessionId).toBe('sess_1');

		pick([makeFile('stale.txt')]);
		await new Promise((resolve) => setTimeout(resolve, 10));

		menuToggle().click();
		endChatBtn().click();
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(widget.sessionId).toBeNull();

		await new Promise((resolve) => setTimeout(resolve, 150));

		expect(widget.sessionId, 'a closed session must not come back').toBeNull();
		expect(window.localStorage.getItem('basjoo_session_agent-1')).toBeNull();
		expect(chips()).toHaveLength(0);

		widget.destroy();
	});

	it('drops every batch of a concurrent pick made before a reset', async () => {
		installFetch({ uploadDelayMs: 60 });
		const widget = makeWidget('en-US');
		await widget.init();
		await sendOne('first turn');

		// Two overlapping batches; the chain serializes them. The reset must
		// invalidate the queued one too, not only the in-flight one.
		pick([makeFile('a.txt')]);
		pick([makeFile('b.txt')]);
		await new Promise((resolve) => setTimeout(resolve, 5));

		menuToggle().click();
		newChatBtn().click();

		await new Promise((resolve) => setTimeout(resolve, 250));

		expect(widget.sessionId).toBeNull();
		expect(chips()).toHaveLength(0);

		widget.destroy();
	});

	it('silently discards a failed stale upload after a reset', async () => {
		// The route refuses the upload, but it is refused *after* the visitor
		// reset: the rejection belongs to the old conversation, so it must not
		// surface an error banner on the new one.
		installFetch({ uploadDelayMs: 60, uploadStatus: 413 });
		const widget = makeWidget('en-US');
		await widget.init();
		await sendOne('first turn');

		pick([makeFile('nope.txt')]);
		await new Promise((resolve) => setTimeout(resolve, 10));

		menuToggle().click();
		newChatBtn().click();

		await new Promise((resolve) => setTimeout(resolve, 150));

		expect(chips()).toHaveLength(0);
		expect(errors(), 'a stale rejection must not contaminate the new chat').toEqual([]);

		widget.destroy();
	});

	it('drops an upload that lands after an identity change', async () => {
		installFetch({ uploadDelayMs: 60 });
		const widget = makeWidget('en-US');
		await widget.init();
		await sendOne('first turn');
		expect(widget.sessionId).toBe('sess_1');

		pick([makeFile('stale.txt')]);
		await new Promise((resolve) => setTimeout(resolve, 10));

		widget.identify({ email: 'new@example.com', hash: 'abc' });
		await new Promise((resolve) => setTimeout(resolve, 150));

		expect(chips()).toHaveLength(0);

		widget.destroy();
	});

	it('does not surface a stale 403 identity_mismatch that lands after a reset', async () => {
		// The 403 was answered against the old conversation, and the visitor has
		// already left it. Its identity sentence must not appear on the new chat,
		// nor fall through to the generic "upload failed" banner.
		installFetch({ uploadDelayMs: 60, uploadStatus: 403, uploadDetail: 'identity_mismatch' });
		const widget = makeWidget('en-US');
		await widget.init();
		await sendOne('first turn');

		pick([makeFile('stale.txt')]);
		await new Promise((resolve) => setTimeout(resolve, 10));

		menuToggle().click();
		newChatBtn().click();

		await new Promise((resolve) => setTimeout(resolve, 150));

		expect(chips()).toHaveLength(0);
		expect(errors(), 'a stale identity rejection must not contaminate the new chat').toEqual([]);

		widget.destroy();
	});

	it('does not surface a 403 identity_mismatch that is still parsing when the reset happens', async () => {
		// The fetch has resolved but `response.json()` has not. A reset inside
		// that window must beat the identity sentence, or it lands on the new
		// chat even though the check already ran once before parsing began.
		installFetch({ uploadStatus: 403, uploadDetail: 'identity_mismatch', jsonDelayMs: 60 });
		const widget = makeWidget('en-US');
		await widget.init();
		await sendOne('first turn');

		pick([makeFile('stale.txt')]);
		// The rejection is being parsed now; reset in the middle of it.
		await new Promise((resolve) => setTimeout(resolve, 10));

		menuToggle().click();
		newChatBtn().click();

		await new Promise((resolve) => setTimeout(resolve, 150));

		expect(chips()).toHaveLength(0);
		expect(errors()).toEqual([]);

		widget.destroy();
	});

	it('unblocks a new upload after a reset instead of waiting on the stale request', async () => {
		// The old upload never settles on its own. Without aborting it, the
		// serialized chain waits forever, so the fresh conversation's pick never
		// uploads and the attach button stays disabled. The reset must cancel it.
		installFetch({ hangFirstUpload: true });
		const widget = makeWidget('en-US');
		await widget.init();
		await sendOne('first turn');

		pick([makeFile('stale.txt')]);
		await new Promise((resolve) => setTimeout(resolve, 10));

		menuToggle().click();
		newChatBtn().click();
		await new Promise((resolve) => setTimeout(resolve, 10));

		const attach = document.querySelector('.basjoo-attach') as HTMLButtonElement;
		expect(attach.disabled, 'the reset must free the composer').toBe(false);

		pick([makeFile('fresh.txt')]);
		await new Promise((resolve) => setTimeout(resolve, 60));

		expect(chips(), 'the fresh pick must upload without the stale request').toHaveLength(1);

		widget.destroy();
	});

	it('aborts an upload body stalled after its headers, so the next upload and send run', async () => {
		// `fetch` resolves (headers are in) but `response.json()` never settles
		// unless the request is aborted. The old code cleared the abort controller
		// at the header boundary, so a reset could not cancel the body: the
		// serialized chain never drained, `uploadsInFlight` stayed positive, and
		// the composer stayed disabled for the rest of the conversation.
		const calls = installFetch({ stallBodyUntilAbort: true });
		const widget = makeWidget('en-US');
		await widget.init();
		await sendOne('first turn');

		pick([makeFile('stale.txt')]);
		// Let the headers resolve; the body is now stalled in response.json().
		await new Promise((resolve) => setTimeout(resolve, 20));

		menuToggle().click();
		newChatBtn().click();
		await new Promise((resolve) => setTimeout(resolve, 20));

		const attach = document.querySelector('.basjoo-attach') as HTMLButtonElement;
		expect(attach.disabled, 'the reset must abort the stalled body').toBe(false);

		pick([makeFile('fresh.txt')]);
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(chips(), 'the fresh pick must upload').toHaveLength(1);

		await sendOne('second turn');
		const streams = streamCalls(calls);
		expect(streams, 'the fresh turn must have gone out').toHaveLength(2);
		const sentIds = (streams[1].body as { attachment_ids?: string[] }).attachment_ids ?? [];
		expect(sentIds, 'the fresh attachment travels with the send').toHaveLength(1);

		widget.destroy();
	});
});
