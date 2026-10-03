// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Regression tests for the community bugfix PR.
 *
 * These cover the pure logic behind the fixes that can be exercised without a
 * live Durable Object / Email Routing setup:
 *   - #36  LIKE pattern clamping for SQLite compatibility
 *   - #4   API key bearer bypass of Cloudflare Access
 *
 * Run with:  npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
	MAX_LIKE_PATTERN_LENGTH,
	toLikePattern,
} from "../workers/lib/sql-patterns.ts";
import {
	timingSafeEqual,
	isValidApiKeyHeader,
} from "../workers/lib/api-key.ts";

// ── #36: LIKE pattern clamping ─────────────────────────────────────

describe("toLikePattern", () => {
	test("wraps a normal term in wildcards", () => {
		assert.equal(toLikePattern("invoice"), "%invoice%");
	});

	test("trims surrounding whitespace", () => {
		assert.equal(toLikePattern("  invoice  "), "%invoice%");
	});

	test("truncates absurdly long input instead of passing it to SQLite", () => {
		const long = "a".repeat(10_000);
		const pattern = toLikePattern(long);
		// +2 for the surrounding wildcards.
		assert.equal(pattern.length, MAX_LIKE_PATTERN_LENGTH + 2);
		assert.equal(pattern, `%${"a".repeat(MAX_LIKE_PATTERN_LENGTH)}%`);
	});

	test("strips control characters that would confuse the LIKE matcher", () => {
		// Built programmatically so the source file stays plain text.
		const NUL = String.fromCharCode(0);
		const BEL = String.fromCharCode(7);
		// NUL and BEL are the two the old inline pattern passed through.
		assert.equal(toLikePattern(`in${NUL}voice${BEL}`), "%in voice%");
		assert.equal(toLikePattern("a\tb\nc"), "%a b c%");
	});

	test("preserves user-supplied wildcards", () => {
		assert.equal(toLikePattern("50%"), "%50%%");
		assert.equal(toLikePattern("a_b"), "%a_b%");
	});

	test("handles empty input", () => {
		assert.equal(toLikePattern(""), "%%");
	});

	test("truncates rather than reordering a long term", () => {
		const long = "needle" + "z".repeat(500);
		const pattern = toLikePattern(long);
		assert.ok(pattern.startsWith("%needle"));
		assert.equal(pattern.length, MAX_LIKE_PATTERN_LENGTH + 2);
	});
});

// ── #4: API key bearer bypass ──────────────────────────────────────

describe("isValidApiKeyHeader", () => {
	const KEY = "s3cr3t-api-key-value";

	test("accepts a correct bearer token", () => {
		assert.equal(isValidApiKeyHeader(`Bearer ${KEY}`, KEY), true);
	});

	test("is case-insensitive on the scheme and tolerant of extra spacing", () => {
		assert.equal(isValidApiKeyHeader(`bearer ${KEY}`, KEY), true);
		assert.equal(isValidApiKeyHeader(`BEARER ${KEY}`, KEY), true);
		assert.equal(isValidApiKeyHeader(`Bearer   ${KEY}`, KEY), true);
		assert.equal(isValidApiKeyHeader(`  Bearer ${KEY}  `, KEY), true);
	});

	test("rejects a wrong token", () => {
		assert.equal(isValidApiKeyHeader("Bearer wrong-key", KEY), false);
	});

	test("rejects a prefix of the key", () => {
		assert.equal(isValidApiKeyHeader(`Bearer ${KEY.slice(0, 5)}`, KEY), false);
	});

	test("rejects a key with trailing junk", () => {
		assert.equal(isValidApiKeyHeader(`Bearer ${KEY}extra`, KEY), false);
	});

	test("rejects other authorization schemes", () => {
		assert.equal(isValidApiKeyHeader(`Basic ${KEY}`, KEY), false);
		assert.equal(isValidApiKeyHeader(KEY, KEY), false);
	});

	test("rejects a missing header", () => {
		assert.equal(isValidApiKeyHeader(undefined, KEY), false);
		assert.equal(isValidApiKeyHeader("", KEY), false);
	});

	test("is disabled entirely when no API_KEY is configured", () => {
		// Fail-closed: without a configured key nothing can authenticate.
		assert.equal(isValidApiKeyHeader(`Bearer ${KEY}`, undefined), false);
		assert.equal(isValidApiKeyHeader(`Bearer ${KEY}`, ""), false);
		assert.equal(isValidApiKeyHeader("Bearer anything", null), false);
	});

	test("does not accept an empty bearer token", () => {
		assert.equal(isValidApiKeyHeader("Bearer ", KEY), false);
	});
});

describe("timingSafeEqual", () => {
	test("matches identical strings", () => {
		assert.equal(timingSafeEqual("abc123", "abc123"), true);
		assert.equal(timingSafeEqual("", ""), true);
	});

	test("rejects different strings of equal length", () => {
		assert.equal(timingSafeEqual("abc123", "abc124"), false);
	});

	test("rejects strings of different length", () => {
		assert.equal(timingSafeEqual("abc", "abcd"), false);
		assert.equal(timingSafeEqual("", "a"), false);
	});

	test("handles multi-byte characters", () => {
		assert.equal(timingSafeEqual("këy-é", "këy-é"), true);
		assert.equal(timingSafeEqual("këy-é", "key-e"), false);
	});
});