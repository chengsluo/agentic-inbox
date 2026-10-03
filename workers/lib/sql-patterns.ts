// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Helpers for building SQL `LIKE` patterns from user-supplied search input.
 *
 * Kept dependency-free so it can be unit tested without standing up a Durable
 * Object.
 */

/**
 * Maximum length of the user-supplied substring inside a generated LIKE
 * pattern.
 *
 * Durable Object SQLite rejects or otherwise fails on very long bound LIKE
 * patterns, which surfaced to callers as an opaque HTTP 500 from the search
 * endpoint. Capping the pattern keeps a pathological query string from taking
 * the mailbox down.
 */
export const MAX_LIKE_PATTERN_LENGTH = 200;

/**
 * Wrap a user search term in `%...%` for a LIKE match.
 *
 * - Control characters are stripped; they carry no meaning in a search term
 *   and confuse SQLite's LIKE matcher.
 * - The term is truncated to MAX_LIKE_PATTERN_LENGTH.
 * - Wildcard semantics are preserved: `%` and `_` supplied by the user still
 *   act as wildcards, so existing search behaviour does not change.
 */
export function toLikePattern(value: string): string {
	const cleaned = value
		.replace(/[\x00-\x1f\x7f]/g, " ")
		.trim()
		.slice(0, MAX_LIKE_PATTERN_LENGTH);
	return `%${cleaned}%`;
}