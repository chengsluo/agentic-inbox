// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { createServer, type ViteDevServer } from "vite";

const dom = new JSDOM("<div id='root'></div>", { url: "https://inbox.example.com" });
const originalFetch = globalThis.fetch;
const calls: { url: string; options: RequestInit }[] = [];
let server: ViteDevServer;
let renderInlineImages: any;
let SingleMessageView: any;
let ThreadMessage: any;
let EmailIframe: any;

before(async () => {
	Object.assign(globalThis, {
		window: dom.window,
		document: dom.window.document,
		DOMParser: dom.window.DOMParser,
		FileReader: dom.window.FileReader,
		IS_REACT_ACT_ENVIRONMENT: true,
	});
	server = await createServer({
		configFile: false,
		root: fileURLToPath(new URL("../", import.meta.url)),
		server: { middlewareMode: true, hmr: { port: 0 } },
		appType: "custom",
		resolve: { alias: {
			"~": fileURLToPath(new URL("../app", import.meta.url)),
			shared: fileURLToPath(new URL("../shared", import.meta.url)),
		} },
		esbuild: { jsx: "automatic" },
	});
	({ renderInlineImages } = await server.ssrLoadModule("/app/lib/email-body.ts"));
	({ default: SingleMessageView } = await server.ssrLoadModule("/app/components/email-panel/SingleMessageView.tsx"));
	({ default: ThreadMessage } = await server.ssrLoadModule("/app/components/email-panel/ThreadMessage.tsx"));
	({ default: EmailIframe } = await server.ssrLoadModule("/app/components/EmailIframe.tsx"));
});

beforeEach(() => {
	calls.length = 0;
	globalThis.fetch = async (url, options) => {
		calls.push({ url: String(url), options: options ?? {} });
		return { ok: true, blob: async () => new dom.window.Blob(["image"], { type: "image/png" }) } as Response;
	};
});

after(async () => {
	globalThis.fetch = originalFetch;
	await server?.close();
	dom.window.close();
});

const image = { id: "image-1", filename: "screen.png", mimetype: "image/png", size: 5, content_id: "<photo@example.com>", disposition: "inline" };
const render = (body: string, attachments = [image], signal = new AbortController().signal) =>
	renderInlineImages(body, "reader@example.com", "message-1", attachments, signal);
const parse = (html: string) => new dom.window.DOMParser().parseFromString(html, "text/html");

test("CID images render at their exact positions, share one fetch, and keep authentication in the parent", async () => {
	const html = await render(`<p>Before</p><img src='CID:photo%40example.com'><p>Between</p><img src=cid:photo@example.com><p>After</p>`);
	const doc = parse(html);
	assert.deepEqual(Array.from(doc.body.children, (el) => el.tagName), ["P", "IMG", "P", "IMG", "P"]);
	assert.equal(doc.images.length, 2);
	for (const img of doc.images) assert.match(img.src, /^data:image\/png;base64,/);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, "/api/v1/mailboxes/reader@example.com/emails/message-1/attachments/image-1");
	assert.equal(calls[0].options.credentials, "same-origin");
});

test("a CID reference renders even when its attachment disposition is not inline", async () => {
	const html = await render('<img src="cid:photo@example.com">', [{ ...image, disposition: "attachment" }]);
	assert.match(parse(html).images[0].src, /^data:image\/png/);
});

test("unreferenced inline screenshots appear in order after the text, including an empty body", async () => {
	const attachments = [1, 2].map((n) => ({ ...image, id: `shot-${n}`, filename: `shot-${n}.png`, content_id: "" }));
	for (const body of ["<p>See screenshots</p>", ""]) {
		const doc = parse(await render(body, attachments));
		assert.deepEqual(Array.from(doc.images, (img) => img.alt), ["shot-1.png", "shot-2.png"]);
		for (const img of doc.images) assert.match(img.src, /^data:image\/png/);
		if (body) assert.equal(doc.body.firstElementChild?.textContent, "See screenshots");
	}
});

test("regular downloads, external images, and unknown or prefix CIDs are not fetched as inline attachments", async () => {
	const body = '<p>cid:photo@example.com</p><img src="https://example.com/image.png"><img src="cid:photo@example.com.extra"><img src="cid:unknown">';
	const html = await render(body, [{ ...image, disposition: "attachment" }]);
	assert.equal(calls.length, 0);
	assert.equal(parse(html).images[0].src, "https://example.com/image.png");
	assert.match(html, /<p>cid:photo@example.com<\/p>/);
});

test("resolved images still pass sanitization and do not retain a competing srcset", async () => {
	const html = await render('<script>alert(1)</script><style>body{display:none}</style><img src="cid:photo@example.com" srcset="https://evil.example/img 2x" onerror="alert(1)"><a href="javascript:alert(1)">link</a>');
	assert.doesNotMatch(html, /script|<style|onerror|javascript:|srcset/);
	assert.match(parse(html).images[0].src, /^data:image\/png/);
});

test("a failed image does not prevent other images or message text from rendering", async () => {
	globalThis.fetch = async (url) => {
		if (String(url).endsWith("image-1")) throw new Error("Network error");
		return { ok: true, blob: async () => new dom.window.Blob(["image"], { type: "image/png" }) } as Response;
	};
	const doc = parse(await render('<p>Message text</p><img src="cid:photo@example.com">', [image, { ...image, id: "image-2", content_id: "" }]));
	assert.equal(doc.body.firstElementChild?.textContent, "Message text");
	assert.match(doc.images[1].src, /^data:image\/png/);
});

test("an Access login response cannot become an inline image", async () => {
	globalThis.fetch = async () => ({ ok: true, blob: async () => new dom.window.Blob(["login"], { type: "text/html" }) }) as Response;
	assert.doesNotMatch(await render('<img src="cid:photo@example.com">'), /data:/);
});

test("cancelling a message load prevents image insertion", async () => {
	const controller = new AbortController();
	controller.abort();
	assert.doesNotMatch(await render('<img src="cid:photo@example.com">', [image], controller.signal), /data:/);
	assert.equal(calls[0].options.signal?.aborted, true);
});

test("auto-sized iframes remove viewport-height dependencies before and after inline images load", async () => {
	const root = createRoot(document.getElementById("root")!);
	let finish: (response: Response) => void;
	globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
	const body = `<div style="height:calc(100vh + 10px); color:red; padding:8px; width:80vw">Text</div>
		<div style="--size:100dvh; min-height:calc(var(--size, 100svh) + 10px)">Variables</div>
		<div style="font-size:10vmax; margin:1lvmin; width:50vb; padding:10vi !important">Logical units</div>
		<img src="cid:photo@example.com" style="max-height:100lvh; width:200px">`;
	const props = { body, mailboxId: "reader@example.com", emailId: "message-1", attachments: [image] };
	const assertStableStyles = (html: string) => {
		const doc = parse(html);
		const [text, variables, logical] = Array.from(doc.body.querySelectorAll("div"));
		assert.equal(text.style.height, "");
		assert.equal(text.style.color, "red");
		assert.equal(text.style.padding, "8px");
		assert.equal(text.style.width, "80vw");
		assert.equal(variables.style.getPropertyValue("--size"), "");
		assert.equal(variables.style.minHeight, "");
		assert.equal(logical.style.length, 0);
		assert.equal(doc.images[0].style.maxHeight, "");
		assert.equal(doc.images[0].style.width, "200px");
	};
	try {
		await act(async () => root.render(createElement(EmailIframe, { ...props, autoSize: true })));
		const iframe = document.querySelector("iframe")!;
		assertStableStyles(iframe.srcdoc);
		await act(async () => {
			finish!({ ok: true, blob: async () => new dom.window.Blob(["image"], { type: "image/png" }) } as Response);
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		assertStableStyles(iframe.srcdoc);
		assert.match(parse(iframe.srcdoc).images[0].src, /^data:image\/png/);
		await act(async () => root.render(createElement(EmailIframe, { body, autoSize: false })));
		assert.match(parse(iframe.srcdoc).body.querySelector("div")!.style.height, /100vh/);
	} finally {
		await act(async () => root.unmount());
	}
});

for (const name of ["single message", "expanded thread"]) {
	test(`${name} wires attachments into the real iframe and cancels loads when switching messages`, async () => {
		const component = name === "single message" ? SingleMessageView : ThreadMessage;
		const root = createRoot(document.getElementById("root")!);
		let finish: (response: Response) => void;
		let signal: AbortSignal;
		globalThis.fetch = (_, options) => {
			signal = options!.signal!;
			return new Promise((resolve) => { finish = resolve; });
		};
		const email = { id: "old", sender: "sender@example.com", recipient: "reader@example.com", date: "2026-10-08", body: '<p>Old text</p><img src="cid:photo@example.com">', attachments: [image] };
		const props = { email, mailboxId: "reader@example.com", onPreviewImage: () => {}, isExpanded: true, isLast: true, onToggleExpand: () => {} };
		try {
			await act(async () => root.render(createElement(component, props)));
			const iframe = document.querySelector("iframe")!;
			assert.match(iframe.srcdoc, /Old text/);
			assert.equal(iframe.getAttribute("sandbox")?.includes("allow-same-origin"), false);
			await act(async () => root.render(createElement(component, { ...props, email: { ...email, id: "new", body: "New text", attachments: [] } })));
			assert.equal(signal!.aborted, true);
			await act(async () => {
				finish!({ ok: true, blob: async () => new dom.window.Blob(["image"], { type: "image/png" }) } as Response);
				await new Promise((resolve) => setTimeout(resolve, 20));
			});
			assert.match(iframe.srcdoc, /New text/);
			assert.doesNotMatch(iframe.srcdoc, /Old text|data:image/);
		} finally {
			await act(async () => root.unmount());
		}
	});
}
