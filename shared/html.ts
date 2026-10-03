// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Hardened HTML text helpers shared by the browser app and the Worker.
 *
 * ## Why this module exists
 *
 * The same fragile patterns used to be duplicated across
 * `app/lib/utils.ts`, `app/components/EmailPanel.tsx` and
 * `workers/lib/email-helpers.ts`:
 *
 *   - `<script[^>]*>[\\s\\S]*?</script>` does not match closing tags written as
 *     `</script >` or `</script\n>`, so a whole script element survived the
 *     filter. CodeQL: `js/bad-tag-filter`.
 *   - Because the filter was non-greedy and required a closing tag, an
 *     unterminated `<script>` left `<script` in the output.
 *     CodeQL: `js/incomplete-multi-character-sanitization`.
 *   - `decodeHtmlEntities()` chained one `.replace()` per entity, so a
 *     replacement could synthesise a *new* entity that a later replacement in
 *     the same chain would then decode. `&amp;lt;script&amp;gt;` therefore
 *     decoded to `&lt;script&gt;`, which a downstream consumer (or a second
 *     pass) turns back into `<script>`. CodeQL: `js/double-escaping`.
 *
 * Fixing the pattern once here keeps the three call sites in sync and makes
 * the behaviour unit-testable without a DOM.
 *
 * ## Security boundary
 *
 * These helpers produce *plain text* for display and for AI prompts. They are
 * not an HTML sanitiser and must not be treated as one. The security boundary
 * for rendering untrusted email HTML remains:
 *
 *   - the browser: `DOMPurify.sanitize()` in `app/lib/utils.ts`, and
 *   - the agent chat / message views: the sandboxed iframe.
 *
 * Everything produced here is additionally HTML-escaped at the point where it
 * is interpolated into markup (`escapeHtml`), which is what makes it safe to
 * display.
 */

/**
 * Elements whose *content* must be discarded, not just their tags.
 *
 * A tag strip that leaves `<script>alert(1)</script>`'s payload behind as text
 * is still a bug even when the tags themselves are removed, because the
 * payload can be re-parsed by any consumer that treats the result as HTML.
 */
const RAW_TEXT_ELEMENTS = [
	"script",
	"style",
	"iframe",
	"frame",
	"frameset",
	"noframes",
	"noscript",
	"object",
	"embed",
	"applet",
	"template",
	"svg",
	"math",
	"xmp",
	"listing",
	"plaintext",
] as const;

/**
 * Matches an entire raw-text element, including its content.
 *
 * Correctness details that the previous regex got wrong:
 *
 *   - `\b` after the tag name, so `<script>` and `<script\n>` match but
 *     `<scripting>` does not.
 *   - `<\/\1\s*>` uses a backreference so the closing tag must match the
 *     opening tag, and tolerates whitespace before `>`. This is what fixes the
 *     `</script >` case behind `js/bad-tag-filter`.
 *   - `|$` as the alternative terminator means an *unterminated* element is
 *     consumed to the end of input instead of leaking its `<script` opener.
 *     This is what fixes `js/incomplete-multi-character-sanitization`.
 *   - The `i` flag covers `<SCRIPT>` / `</ScRiPt >` casing tricks.
 */
const RAW_TEXT_ELEMENT_RE = new RegExp(
	`<(${RAW_TEXT_ELEMENTS.join("|")})\\b[^>]*>[\\s\\S]*?(?:<\\/\\1\\s*>|$)`,
	"gi",
);

/** HTML comments, including unterminated ones. */
const COMMENT_RE = /<!--[\s\S]*?(?:-->|$)/g;

/** CDATA, doctypes and processing instructions (`<!DOCTYPE …>`, `<?xml … ?>`, `<% … %>`). */
const MARKUP_DECL_RE = /<![^>]*>|<\?[\s\S]*?\?>|<%[\s\S]*?%>/g;

/**
 * Any remaining tag, including truncated ones at the end of input.
 *
 * `[a-zA-Z/!?]` keeps a bare `<` that is not actually introducing a tag, so
 * "5 < 6" survives intact.
 */
const ANY_TAG_RE = /<[/!?]?[a-zA-Z][^>]*>?|<[/!?]?[^>]*$/g;

/** Named entities we decode. Anything else is left untouched. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	ensp: " ",
	emsp: " ",
	thinsp: " ",
	copy: "©",
	reg: "®",
	trade: "™",
	hellip: "…",
	mdash: "—",
	ndash: "–",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	laquo: "«",
	raquo: "»",
	bull: "•",
	middot: "·",
	deg: "°",
	plusmn: "±",
	times: "×",
	divide: "÷",
	frac12: "½",
	frac14: "¼",
	frac34: "¾",
	sup2: "²",
	sup3: "³",
	micro: "µ",
	para: "¶",
	sect: "§",
	dagger: "†",
	Dagger: "‡",
	permil: "‰",
	prime: "′",
	Prime: "″",
	euro: "€",
	pound: "£",
	yen: "¥",
	cent: "¢",
	curren: "¤",
	larr: "←",
	uarr: "↑",
	rarr: "→",
	darr: "↓",
	harr: "↔",
	infin: "∞",
	ne: "≠",
	le: "≤",
	ge: "≥",
	shy: "­",
	zwj: "‍",
	zwnj: "‌",
};

/**
 * A single entity, captured in one alternation:
 *   1. decimal numeric   &#123;
 *   2. hex numeric       &#x7B;
 *   3. named             &amp;
 *
 * One pattern with one pass is what prevents double-decoding: `replace` never
 * re-examines the text it just produced, so a replacement can never be
 * decoded a second time.
 */
const HTML_ENTITY_RE =
	/&(?:#([0-9]+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]{1,31}));/g;

/**
 * Convert a numeric character reference to a string.
 * Returns null for references that are not valid Unicode scalar values, so the
 * caller can leave the original text alone instead of emitting U+0000 or a lone
 * surrogate.
 */
function fromCodePoint(code: number): string | null {
	if (
		!Number.isFinite(code) ||
		code < 0 ||
		// 0 and the surrogate range are not valid scalar values.
		code === 0 ||
		(code >= 0xd800 && code <= 0xdfff) ||
		code > 0x10ffff
	) {
		return null;
	}
	return String.fromCodePoint(code);
}

/**
 * Decode HTML entities in a single pass.
 *
 * Decoding happens exactly once: the output is never rescanned, so
 * `&amp;lt;script&amp;gt;` correctly yields the literal text `&lt;script&gt;`
 * rather than `<script>`.
 *
 * Numeric references that are not valid Unicode scalar values (NUL, lone
 * surrogates, out-of-range) and unknown named references are left verbatim.
 */
export function decodeHtmlEntities(text: string): string {
	if (!text) return "";
	return text.replace(
		HTML_ENTITY_RE,
		(match, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
			if (dec !== undefined) {
				const decoded = fromCodePoint(Number.parseInt(dec, 10));
				return decoded ?? match;
			}
			if (hex !== undefined) {
				const decoded = fromCodePoint(Number.parseInt(hex, 16));
				return decoded ?? match;
			}
			return NAMED_ENTITIES[name as string] ?? match;
		},
	);
}

/**
 * Escape all five OWASP-recommended HTML special characters.
 * Safe for use in both text content and attribute contexts.
 */
export function escapeHtml(text: string): string {
	if (!text) return "";
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Remove elements that can execute or carry executable content, together with
 * everything inside them.
 */
export function stripDangerousElements(html: string): string {
	if (!html) return "";
	let out = html.replace(COMMENT_RE, "").replace(MARKUP_DECL_RE, "");
	// Run twice: nesting such as `<script><script>…</script></script>` leaves a
	// fresh opener behind after the first pass.
	out = out.replace(RAW_TEXT_ELEMENT_RE, "");
	out = out.replace(RAW_TEXT_ELEMENT_RE, "");
	return out;
}

/**
 * Remove every remaining tag.
 *
 * Runs after {@link stripDangerousElements} and is deliberately total: it also
 * drops a trailing unterminated `<…` so a truncated document cannot leak a
 * dangling opener.
 */
export function stripHtmlTags(html: string): string {
	if (!html) return "";
	let out = stripDangerousElements(html);
	out = out.replace(ANY_TAG_RE, "");
	// Defence in depth: if a second pass still finds something that reads like a
	// tag opener, cut from that `<` to the end. `replace` with `g` keeps working
	// through the string without looping.
	return out.replace(/<[a-zA-Z\/!?][\s\S]*$/, "");
}

/**
 * Strip dangerous elements and all tags, leaving readable text.
 *
 * Block-level tags become newlines and runs of horizontal whitespace collapse,
 * so paragraphs stay separated the way the previous DOM-based implementation
 * rendered them. Newlines inserted for block boundaries are preserved.
 */
export function htmlToPlainText(html: string): string {
	if (!html) return "";
	return stripHtmlTags(
		stripDangerousElements(html)
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/(?:p|div|tr|li|h[1-6]|blockquote|pre)\s*>/gi, "\n\n")
			.replace(/<(?:p|div|tr|li|h[1-6]|blockquote|pre)\b[^>]*>/gi, "\n"),
	)
		// Collapse horizontal runs only — collapsing \s+ would flatten the block
		// boundaries we just inserted.
		.replace(/[^\S\n]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Collapse all HTML to a single-line text snippet: no tags, no newlines.
 */
export function stripHtmlToText(html: string): string {
	if (!html) return "";
	return stripHtmlTags(html)
		.replace(/\s+/g, " ")
		.trim();
}