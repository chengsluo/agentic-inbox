// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
let EmailAttachmentList: any;

before(async () => {
	// Load the real TSX component with its existing Vite dependencies; no DOM or
	// live mailbox is needed to verify which attachments users can access.
	server = await createServer({
		configFile: false,
		root: fileURLToPath(new URL("../", import.meta.url)),
		server: { middlewareMode: true },
		appType: "custom",
		resolve: {
			alias: {
				"~": fileURLToPath(new URL("../app", import.meta.url)),
				shared: fileURLToPath(new URL("../shared", import.meta.url)),
			},
		},
		esbuild: { jsx: "automatic" },
	});
	({ default: EmailAttachmentList } = await server.ssrLoadModule(
		"/app/components/EmailAttachmentList.tsx",
	));
});

after(async () => {
	await server?.close();
});

const screenshots = [1, 2].map((index) => ({
	id: `screenshot-${index}`,
	filename: `cuka-screenshot-${index}.jpg`,
	mimetype: "image/jpeg",
	size: 120_000,
	content_id: null,
	disposition: "inline",
}));

function render(attachments?: object[], extraProps = {}) {
	return renderToStaticMarkup(createElement(EmailAttachmentList, {
		mailboxId: "rewards@example.com",
		emailId: "message-1",
		attachments,
		...extraProps,
	}));
}

test("iPhone screenshots without Content-IDs have image preview buttons", () => {
	const html = render(screenshots, { onPreviewImage: () => {}, showHeading: true });
	assert.match(html, /2 attachments/);
	assert.match(html, /cuka-screenshot-1\.jpg/);
	assert.match(html, /cuka-screenshot-2\.jpg/);
	assert.equal((html.match(/<button\b/g) ?? []).length, 2);
});

test("inline images with Content-IDs and regular files retain download links", () => {
	const html = render([
		{ ...screenshots[0], content_id: "screenshot@example.com" },
		{ id: "document", filename: "receipt.pdf", mimetype: "application/pdf", size: 100, disposition: "attachment" },
	]);
	assert.match(html, /href="\/api\/v1\/mailboxes\/rewards@example\.com\/emails\/message-1\/attachments\/screenshot-1"/);
	assert.match(html, /href="\/api\/v1\/mailboxes\/rewards@example\.com\/emails\/message-1\/attachments\/document"/);
	assert.match(html, /receipt\.pdf/);
});

test("empty attachments or a missing mailbox produce no attachment list", () => {
	assert.equal(render(), "");
	assert.equal(render([]), "");
	assert.equal(render(screenshots, { mailboxId: undefined }), "");
});
