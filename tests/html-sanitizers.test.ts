// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Tests for the hardened HTML text helpers.
 *
 * Each test names the CodeQL rule it closes:
 *   - js/bad-tag-filter
 *   - js/incomplete-multi-character-sanitization
 *   - js/double-escaping
 *
 * Run with:  npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
	decodeHtmlEntities,
	escapeHtml,
	stripDangerousElements,
	stripHtmlTags,
	htmlToPlainText,
	stripHtmlToText,
} from "../shared/html.ts";

/** A payload only survives if tag filtering failed. */
function assertNoLiveTag(input: string, output: string) {
	assert.ok(
		!/<\s*\/?\s*(script|style|iframe|object|embed|svg|math)/i.test(output),
		`output still contains a live tag for input ${JSON.stringify(input)}: ${JSON.stringify(output)}`,
	);
}

// ── js/bad-tag-filter: closing tags with whitespace ─────────────────

describe("stripHtmlToText: closing-tag variants", () => {
	const payloads = [
		"<script>alert(1)</script>",
		"<script>alert(1)</script >",
		"<script>alert(1)</script\t>",
		"<script>alert(1)</script\n>",
		"<script >alert(1)</script >",
		"<SCRIPT>alert(1)</SCRIPT >",
		"<script\n>alert(1)</script\n\n>",
	];

	for (const payload of payloads) {
		test(`neutralises ${JSON.stringify(payload)}`, () => {
			const out = stripHtmlToText(payload);
			assertNoLiveTag(payload, out);
			assert.ok(!out.includes("alert(1)"), "script payload text survived");
		});
	}

	test("does not treat a tag-name prefix as the element", () => {
		// `<scripting>` is not `<script>`; the word boundary must keep the text.
		const out = stripHtmlToText("<scripting>hello</scripting>");
		assert.equal(out, "hello");
	});

	test("requires the closing tag to match the opening tag", () => {
		const out = stripHtmlToText("<script>alert(1)</style>");
		assertNoLiveTag("<script>alert(1)</style>", out);
	});
});

// ── js/incomplete-multi-character-sanitization: unterminated tags ───

describe("stripHtmlToText: unterminated and nested", () => {
	const payloads = [
		"<script>alert(1)", // no closing tag
		"<style>body{}", // no closing tag
		"<script>alert(1)</script", // truncated closer
		"<script><script>alert(1)</script></script>", // nested
		"<iframe src=evil>fallback</iframe >", // whitespace in closer
		"<svg><script>alert(1)</script></svg >",
	];

	for (const payload of payloads) {
		test(`neutralises ${JSON.stringify(payload)}`, () => {
			const out = stripHtmlToText(payload);
			assertNoLiveTag(payload, out);
			assert.ok(
				!/<\s*script/i.test(out),
				`"<script" survived for ${JSON.stringify(payload)}: ${JSON.stringify(out)}`,
			);
		});
	}

	test("a truncated tag at end of input cannot leak an opener", () => {
		const out = stripHtmlToText("hello <div class=\"unterminated");
		assert.equal(out, "hello");
	});

	test("keeps a bare less-than that is not a tag", () => {
		assert.equal(stripHtmlToText("5 < 6 and 7 > 6"), "5 < 6 and 7 > 6");
	});

	test("keeps a bare less-than with no later greater-than", () => {
		assert.equal(stripHtmlToText("I <3 this"), "I <3 this");
		assert.equal(stripHtmlToText("x < 10"), "x < 10");
	});

	test("still drops a truncated closer or declaration at end of input", () => {
		assert.equal(stripHtmlToText("hello </div"), "hello");
		assert.equal(stripHtmlToText("hello <!DOCTYPE html"), "hello");
	});
});

describe("stripHtmlToText: word boundaries", () => {
	test("tags separate words instead of fusing them", () => {
		assert.equal(
			stripHtmlToText("Dear Bob,<br><br>Thanks.<p>Regards,</p>Alice"),
			"Dear Bob, Thanks. Regards, Alice",
		);
		assert.equal(stripHtmlToText("<td>100</td><td>200</td>"), "100 200");
	});
});

// ── js/double-escaping: single-pass entity decoding ─────────────────

describe("decodeHtmlEntities: single pass", () => {
	test("decodes each entity exactly once", () => {
		assert.equal(decodeHtmlEntities("&amp;"), "&");
		assert.equal(decodeHtmlEntities("&lt;"), "<");
		assert.equal(decodeHtmlEntities("&#60;"), "<");
		assert.equal(decodeHtmlEntities("&#x3C;"), "<");
		assert.equal(decodeHtmlEntities("&#X3c;"), "<");
	});

	test("does not double-decode escaped entities", () => {
		// The core double-escaping case: one pass must leave this inert.
		assert.equal(decodeHtmlEntities("&amp;lt;script&amp;gt;"), "&lt;script&gt;");
		assert.equal(decodeHtmlEntities("&amp;#60;script&amp;#62;"), "&#60;script&#62;");
		assert.equal(decodeHtmlEntities("&amp;amp;"), "&amp;");
	});

	test("cannot be walked into an executable tag", () => {
		// After decoding, the text must still not contain a live "<script".
		for (const payload of [
			"&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;",
			"&amp;#60;script&amp;#62;alert(1)&amp;#60;/script&amp;#62;",
			"&#38;lt;script&#38;gt;",
			"&amp;amp;lt;script&amp;amp;gt;",
		]) {
			const decoded = decodeHtmlEntities(payload);
			assertNoLiveTag(payload, decoded);
		}
	});

	test("leaves invalid numeric references untouched", () => {
		assert.equal(decodeHtmlEntities("&#0;"), "&#0;");
		assert.equal(decodeHtmlEntities("&#xD800;"), "&#xD800;"); // lone surrogate
		assert.equal(decodeHtmlEntities("&#x110000;"), "&#x110000;"); // > U+10FFFF
	});

	test("leaves unknown named entities untouched", () => {
		assert.equal(decodeHtmlEntities("&notarealentity;"), "&notarealentity;");
	});

	test("decodes astral code points", () => {
		assert.equal(decodeHtmlEntities("&#x1F600;"), "\u{1F600}");
	});

	test("handles plain text and empty input", () => {
		assert.equal(decodeHtmlEntities("no entities here"), "no entities here");
		assert.equal(decodeHtmlEntities(""), "");
	});
});

// ── escapeHtml round-trip ───────────────────────────────────────────

describe("escapeHtml", () => {
	test("escapes all five OWASP characters", () => {
		assert.equal(
			escapeHtml(`<img src=x onerror="alert('x')">`),
			"&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;",
		);
	});

	test("escapes ampersand before the other entities", () => {
		assert.equal(escapeHtml("&lt;"), "&amp;lt;");
	});

	test("handles empty input", () => {
		assert.equal(escapeHtml(""), "");
	});
});

// ── htmlToPlainText: block tags become newlines ────────────────────

describe("htmlToPlainText", () => {
	test("turns block boundaries into paragraph breaks", () => {
		assert.equal(htmlToPlainText("<p>one</p><p>two</p>"), "one\n\ntwo");
	});

	test("removes script content but keeps surrounding text", () => {
		const out = htmlToPlainText("<p>before</p><script >alert(1)</script ><p>after</p>");
		assert.equal(out, "before\n\nafter");
		assert.ok(!out.includes("alert(1)"));
	});

	test("handles empty input", () => {
		assert.equal(htmlToPlainText(""), "");
	});
});

// ── stripDangerousElements / stripHtmlTags direct use ──────────────

describe("stripDangerousElements", () => {
	test("removes a comment that hides a tag", () => {
		// A comment must not be a way to smuggle markup through.
		const out = stripDangerousElements("a<!-- <script>x</script> -->b");
		assert.equal(out, "ab");
	});

	test("removes processing instructions", () => {
		assert.equal(stripDangerousElements("<?xml version='1.0'?>text"), "text");
	});
});

describe("stripHtmlTags", () => {
	test("removes attributes and self-closing tags", () => {
		assert.equal(stripHtmlTags(`<div class="a" data-x='1'>hi<br/></div>`), "hi");
	});

	test("keeps text intact around tags", () => {
		assert.equal(stripHtmlTags("a<p>b</p>c"), "abc");
	});
});