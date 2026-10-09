// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import DOMPurify from "dompurify";
import { getAttachmentUrl } from "~/lib/utils";
import type { Attachment } from "~/types";

export function sanitizeEmailBody(body: string): string {
	return DOMPurify.sanitize(body, {
		USE_PROFILES: { html: true },
		FORBID_TAGS: ["style"],
		ADD_ATTR: ["target"],
		FORCE_BODY: true,
	});
}

function normalizeContentId(value: string): string {
	try {
		value = decodeURIComponent(value);
	} catch {
		// Some senders use literal percent signs in Content-IDs.
	}
	return value.trim().replace(/^<|>$/g, "");
}

function readDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

export async function renderInlineImages(
	body: string,
	mailboxId: string,
	emailId: string,
	attachments: Attachment[],
	signal: AbortSignal,
): Promise<string> {
	const doc = new DOMParser().parseFromString(sanitizeEmailBody(body), "text/html");
	const images = Array.from(doc.body.querySelectorAll("img"));
	await Promise.all(attachments.filter((att) => att.mimetype.startsWith("image/")).map(async (att) => {
		const contentId = att.content_id ? normalizeContentId(att.content_id) : null;
		const targets = images.filter((img) => {
			const src = img.getAttribute("src") ?? "";
			return contentId && /^cid:/i.test(src) && normalizeContentId(src.slice(4)) === contentId;
		});
		if (!targets.length && att.disposition !== "inline") return;

		// iPhone Mail can send inline screenshots without any body reference.
		// Show them after the text when the sender supplied no position to restore.
		if (!targets.length) {
			const paragraph = doc.createElement("p");
			const img = doc.createElement("img");
			img.alt = att.filename;
			paragraph.appendChild(img);
			doc.body.appendChild(paragraph);
			targets.push(img);
		}

		try {
			// Fetch in the authenticated parent page: the opaque-origin iframe
			// cannot reliably authenticate attachment requests. Data URLs also
			// work within its existing CSP without weakening the sandbox.
			const response = await fetch(getAttachmentUrl(mailboxId, emailId, att.id), {
				credentials: "same-origin",
				signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
			});
			if (!response.ok) return;
			const blob = await response.blob();
			if (!blob.type.startsWith("image/")) return;
			const url = await readDataUrl(blob);
			if (signal.aborted) return;
			for (const img of targets) {
				img.removeAttribute("srcset");
				img.setAttribute("src", url);
			}
		} catch {
			// A missing image must not hide the message or other images.
			// The attachment list retains its preview/download entry for retrying.
		}
	}));
	return sanitizeEmailBody(doc.body.innerHTML);
}
