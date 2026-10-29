// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Normalize the SMTP envelope sender (MAIL FROM) handed to us by Cloudflare
 * Email Routing as `event.from`.
 *
 * This is the address the connecting SMTP client claimed, not anything parsed
 * from the message, so it can't be spoofed via MIME headers. It is NOT proof
 * of identity: a client can claim any MAIL FROM, and a match with the From:
 * header only means the two are consistent. Forwarders (SRS), mailing lists
 * and ESP bounce addresses legitimately differ from From:.
 *
 * Returns null for the null reverse-path (`<>`, used by bounces/DSNs) so an
 * empty string is never stored as if it were a real sender.
 */
export function normalizeEnvelopeSender(from: string | null | undefined): string | null {
	const value = (from ?? "").trim().toLowerCase();
	if (!value || value === "<>") return null;
	return value;
}
