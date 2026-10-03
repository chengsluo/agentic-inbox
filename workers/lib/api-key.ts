// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Optional API-key authentication for non-browser clients.
 *
 * Cloudflare Access protects this app with an interactive browser redirect,
 * which is fine for the UI but unusable for webhooks, CI jobs, scripts and MCP
 * servers. When an `API_KEY` secret is configured, clients may instead present
 * `Authorization: Bearer <API_KEY>` and skip the Access dance.
 *
 * When `API_KEY` is unset these helpers always report "not authorised", so the
 * default deployment keeps its Access-only behaviour.
 */

/**
 * Length-independent, constant-time string comparison.
 *
 * A plain `===` leaks how many leading bytes matched through response timing,
 * which lets an attacker recover an API key byte by byte. Folding the length
 * difference into the same accumulator also avoids an early return on
 * mismatched lengths.
 */
export function timingSafeEqual(a: string, b: string): boolean {
	const aBytes = new TextEncoder().encode(a);
	const bBytes = new TextEncoder().encode(b);
	let diff = aBytes.length ^ bBytes.length;
	const len = Math.max(aBytes.length, bBytes.length);
	for (let i = 0; i < len; i++) {
		diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
	}
	return diff === 0;
}

/**
 * Verify an `Authorization` header against the configured API key.
 *
 * @param header     - Raw `Authorization` header value, if any.
 * @param apiKey     - The configured API_KEY secret; empty/undefined disables
 *                     API-key auth entirely.
 */
export function isValidApiKeyHeader(
	header: string | undefined | null,
	apiKey: string | undefined | null,
): boolean {
	if (!apiKey) return false;
	if (!header) return false;

	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	if (!match) return false;

	return timingSafeEqual(match[1].trim(), apiKey);
}