// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Parsing and matching rules for the per-mailbox sender blocklist.
 *
 * Kept dependency-free so the exact same rules are used when purging existing
 * mail, when filtering inbound mail, and in unit tests.
 *
 * Entries are either a full address (`spam@example.com`) or a domain
 * (`example.com`). A domain entry also covers its subdomains, so blocking
 * `example.com` blocks `news@mail.example.com` too.
 */

export type BlockKind = "address" | "domain";

export interface BlockEntry {
	value: string;
	kind: BlockKind;
}

export class BlockEntryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BlockEntryError";
	}
}

const MAX_ADDRESS_LENGTH = 320;

// Hostname with at least two labels. Single labels (e.g. "com") are rejected
// so a typo cannot block an entire TLD.
const DOMAIN_RE =
	/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const LOCAL_PART_RE = /^[^\s@<>"(),;:\\[\]]+$/;

/**
 * Normalize user input into a block entry.
 *
 * Accepts `user@example.com`, `Name <user@example.com>`, `example.com`,
 * `@example.com` and `*@example.com`. Throws BlockEntryError on anything else.
 */
export function normalizeBlockEntry(raw: string): BlockEntry {
	let value = String(raw ?? "").trim().toLowerCase();
	const bracketed = value.match(/<([^>]+)>/);
	if (bracketed) value = bracketed[1].trim();
	value = value.replace(/^\*?@/, "");

	if (!value) throw new BlockEntryError("Enter an email address or domain to block");
	if (value.length > MAX_ADDRESS_LENGTH) throw new BlockEntryError("Address is too long");

	const at = value.lastIndexOf("@");
	if (at === -1) {
		if (!DOMAIN_RE.test(value)) throw new BlockEntryError(`"${value}" is not a valid domain`);
		return { value, kind: "domain" };
	}

	const local = value.slice(0, at);
	const domain = value.slice(at + 1);
	if (!LOCAL_PART_RE.test(local) || !DOMAIN_RE.test(domain)) {
		throw new BlockEntryError(`"${value}" is not a valid email address`);
	}
	return { value, kind: "address" };
}

/** Domain part of an address, lowercased, or null if there is none. */
export function senderDomain(sender: string | null | undefined): string | null {
	const s = String(sender ?? "").trim().toLowerCase();
	const at = s.lastIndexOf("@");
	if (at === -1 || at === s.length - 1) return null;
	return s.slice(at + 1);
}

/** Return the first entry that blocks `sender`, or null. */
export function matchesBlock(
	sender: string | null | undefined,
	entries: readonly BlockEntry[],
): BlockEntry | null {
	const address = String(sender ?? "").trim().toLowerCase();
	if (!address) return null;
	const domain = senderDomain(address);

	for (const entry of entries) {
		if (entry.kind === "address") {
			if (address === entry.value) return entry;
		} else if (domain && (domain === entry.value || domain.endsWith(`.${entry.value}`))) {
			return entry;
		}
	}
	return null;
}
