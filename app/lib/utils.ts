// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared utility functions used across the frontend.
 *
 * Date formatting has been consolidated into `shared/dates.ts`.
 * Re-export for backwards compatibility with existing imports.
 */
import DOMPurify from "dompurify";
import { formatQuotedDate } from "shared/dates";
import {
	decodeHtmlEntities,
	escapeHtml,
	htmlToPlainText as htmlToPlainTextString,
	stripDangerousElements,
	stripHtmlTags,
} from "shared/html";
import type { Attachment } from "~/types";

// `escapeHtml` moved to shared/html; re-exported so existing imports keep working.
export { escapeHtml };

export {
	formatListDate,
	formatDetailDate,
	formatShortDate,
} from "shared/dates";

/** @deprecated Use `formatQuotedDate` from `shared/dates` directly. */
export const formatComposeDate = formatQuotedDate;

/**
 * Format a byte count as a human-readable file size.
 */
export function formatBytes(bytes: number, decimals = 1): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Split a comma-separated email field into individual addresses.
 */
export function splitEmailList(value?: string | null): string[] {
	return (value || "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

/**
 * Convert a list of addresses into the API payload format.
 */
export function toEmailListValue(addresses: string[]): string | string[] | undefined {
	if (addresses.length === 0) return undefined;
	return addresses.length === 1 ? addresses[0] : addresses;
}

/** Tags whose boundaries become newlines when flattening to plain text. */
const BLOCK_TAGS = new Set([
	"P", "LI", "TR", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE",
]);

/**
 * Convert HTML content to plain text.
 * Uses DOM APIs so must only be called client-side.
 */
export function htmlToPlainText(html: string): string {
	// DOMPurify is the security boundary here: it strips scripts, event
	// handlers and other executable content.
	//
	// The sanitised output is assigned to innerHTML *directly*. Nothing —
	// especially no tag-shaped regex — may run in between, because a filter
	// that only partially understands tags is exactly what CodeQL reports as
	// js/incomplete-multi-character-sanitization. DOMPurify also removes
	// <script> and <style> elements wholesale, so their content never reaches
	// textContent.
	const div = document.createElement("div");
	div.innerHTML = DOMPurify.sanitize(html);

	// Block boundaries are turned into newlines via the DOM rather than regex,
	// which keeps the extracted text readable for the `text:` alternative part.
	for (const node of Array.from(
		div.querySelectorAll("br, p, li, tr, h1, h2, h3, h4, h5, h6, blockquote, pre, div"),
	)) {
		const isBreak = node.tagName === "BR";
		const isBlock = BLOCK_TAGS.has(node.tagName);
		const isDiv = node.tagName === "DIV";

		if (isBreak) {
			node.parentNode?.replaceChild(document.createTextNode("\n"), node);
			continue;
		}
		if (isBlock) {
			node.parentNode?.insertBefore(document.createTextNode("\n\n"), node);
		}
		if (isBlock || isDiv) {
			node.parentNode?.insertBefore(document.createTextNode("\n"), node.nextSibling);
		}
	}

	const text = div.textContent || div.innerText || "";
	return text
		.replace(/[^\S\n]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Strip all HTML tags from a string.
 *
 * Delegates to the hardened shared implementation rather than a bare
 * `<[^>]*>` replace, which could be defeated by an unterminated tag and
 * reported by CodeQL as `js/incomplete-multi-character-sanitization`.
 */
export function stripHtml(html: string): string {
	return htmlToPlainTextString(html).replace(/\n+/g, " ").trim();
}

export function getSnippetText(
	snippet?: string | null,
	maxLength = 100,
): string {
	if (!snippet) return "";

	// One hardened pass for the tags, then a single-pass entity decode.
	// decodeHtmlEntities must never run twice over its own output, or
	// "&amp;lt;script&amp;gt;" would collapse into "<script>".
	const clean = decodeHtmlEntities(stripDangerousElements(snippet))
		.replace(/[^\S\n]+/g, " ")
		.replace(/\n+/g, " ")
		.trim();

	const plain = stripHtmlTags(clean, " ").replace(/\s+/g, " ").trim();

	if (!plain) return "";
	return plain.length > maxLength ? `${plain.slice(0, maxLength)}...` : plain;
}

/**
 * Generate the HTML signature block for compose forms.
 */
export function getSignatureBlock(settings?: {
	signature?: { enabled: boolean; text?: string; html?: string };
}): string {
	const sig = settings?.signature;
	if (sig?.enabled && (sig?.html || sig?.text)) {
		// Sanitize HTML signatures with DOMPurify to allow safe formatting
		// (bold, italic, links, etc.) while stripping scripts and event handlers.
		// Text signatures are HTML-escaped since they have no formatting.
		const content = sig.html
			? DOMPurify.sanitize(sig.html)
			: escapeHtml(sig.text || "");
		return `<div style="border-top: 1px solid #ccc; margin-top: 16px; padding-top: 12px;">${content}</div>`;
	}
	return "";
}

/**
 * Build a quoted reply block HTML string from original email data.
 */
export function buildQuotedReplyBlock(
	dateStr: string | undefined,
	sender: string,
	body: string,
): string {
	if (!body) return "";
	const formattedDate = formatComposeDate(dateStr);
	
	// HTML-escape sender to prevent <john@example.com> from disappearing as a tag
	const escapedSender = escapeHtml(sender);

	// Sanitize the body to plain text to prevent stored XSS.
	// The original HTML renders safely in the sandboxed iframe, but quoted
	// reply blocks are injected into the compose editor where raw HTML would
	// execute. Convert to escaped plain text instead.
	const bodyToQuote = escapeHtml(stripHtml(body)).replace(/\n/g, "<br>");

	return `<br><blockquote style="border-left: 2px solid #ccc; margin: 0; padding-left: 1em; color: #666;">On ${formattedDate}, ${escapedSender} wrote:<br><br>${bodyToQuote}</blockquote>`;
}

/**
 * Rewrite CID references in email HTML to API URLs for inline images.
 * Replaces `src="cid:image001@example.com"` with the attachment API endpoint.
 */
export function rewriteInlineImages(
	body: string,
	mailboxId: string,
	emailId: string,
	attachments?: { id: string; content_id?: string | null; disposition?: string | null }[],
): string {
	if (!body || !attachments?.length) return body;
	let result = body;
	for (const att of attachments) {
		if (att.disposition === "inline" && att.content_id) {
			const url = `/api/v1/mailboxes/${mailboxId}/emails/${emailId}/attachments/${att.id}`;
			// Strip angle brackets from content_id if present
			const cid = att.content_id.startsWith("<")
				? att.content_id.slice(1, -1)
				: att.content_id;
			result = result.replace(new RegExp(`cid:${cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi"), url);
		}
	}
	return result;
}

export function getNonInlineAttachments(attachments?: Attachment[]): Attachment[] {
	return attachments?.filter((attachment) => attachment.disposition !== "inline") ?? [];
}

export function getAttachmentUrl(
	mailboxId: string,
	emailId: string,
	attachmentId: string,
): string {
	return `/api/v1/mailboxes/${mailboxId}/emails/${emailId}/attachments/${attachmentId}`;
}

export function downloadFile(url: string, filename: string) {
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.target = "_blank";
	link.rel = "noopener noreferrer";
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
}
