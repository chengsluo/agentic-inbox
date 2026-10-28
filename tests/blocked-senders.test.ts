// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Tests for the sender blocklist rules shared by the purge-on-block path and
 * the inbound email filter.
 *
 * Run with:  npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
	BlockEntryError,
	matchesBlock,
	normalizeBlockEntry,
	senderDomain,
	type BlockEntry,
} from "../workers/lib/blocked-senders.ts";

describe("normalizeBlockEntry", () => {
	test("recognises a plain address", () => {
		assert.deepEqual(normalizeBlockEntry("spam@example.com"), { value: "spam@example.com", kind: "address" });
	});

	test("lowercases and trims", () => {
		assert.deepEqual(normalizeBlockEntry("  Spam@Example.COM "), { value: "spam@example.com", kind: "address" });
	});

	test("extracts the address from a display-name form", () => {
		assert.deepEqual(normalizeBlockEntry("Spammer <spam@example.com>"), { value: "spam@example.com", kind: "address" });
	});

	test("recognises a bare domain", () => {
		assert.deepEqual(normalizeBlockEntry("example.com"), { value: "example.com", kind: "domain" });
	});

	test("accepts @domain and *@domain as domain entries", () => {
		assert.deepEqual(normalizeBlockEntry("@example.com"), { value: "example.com", kind: "domain" });
		assert.deepEqual(normalizeBlockEntry("*@Example.com"), { value: "example.com", kind: "domain" });
	});

	test("accepts subdomains and plus-addressing", () => {
		assert.deepEqual(normalizeBlockEntry("mail.example.co.uk"), { value: "mail.example.co.uk", kind: "domain" });
		assert.deepEqual(normalizeBlockEntry("a+tag@example.com"), { value: "a+tag@example.com", kind: "address" });
	});

	test("rejects empty input", () => {
		assert.throws(() => normalizeBlockEntry(""), BlockEntryError);
		assert.throws(() => normalizeBlockEntry("   "), BlockEntryError);
		assert.throws(() => normalizeBlockEntry("@"), BlockEntryError);
	});

	test("rejects a bare TLD so a typo can't block everything", () => {
		assert.throws(() => normalizeBlockEntry("com"), BlockEntryError);
		assert.throws(() => normalizeBlockEntry("@com"), BlockEntryError);
	});

	test("rejects wildcards and invalid domain characters", () => {
		for (const bad of ["*.example.com", "ex_ample.com", "spam@%", "spam@exa%mple.com", "a b@example.com"]) {
			assert.throws(() => normalizeBlockEntry(bad), BlockEntryError, bad);
		}
	});

	test("keeps RFC-legal local-part characters literally (matching is exact, not LIKE)", () => {
		const entry = normalizeBlockEntry("100%_off@example.com");
		assert.deepEqual(entry, { value: "100%_off@example.com", kind: "address" });
		assert.equal(matchesBlock("100xyoff@example.com", [entry]), null);
	});

	test("rejects malformed addresses", () => {
		assert.throws(() => normalizeBlockEntry("spam@"), BlockEntryError);
		assert.throws(() => normalizeBlockEntry("spam@localhost"), BlockEntryError);
		assert.throws(() => normalizeBlockEntry("spam@-bad.com"), BlockEntryError);
	});

	test("rejects absurdly long input", () => {
		assert.throws(() => normalizeBlockEntry(`${"a".repeat(400)}@example.com`), BlockEntryError);
	});
});

describe("senderDomain", () => {
	test("returns the lowercased domain part", () => {
		assert.equal(senderDomain("Bob@Mail.Example.com"), "mail.example.com");
	});

	test("returns null without a domain", () => {
		assert.equal(senderDomain(""), null);
		assert.equal(senderDomain(null), null);
		assert.equal(senderDomain("nobody"), null);
		assert.equal(senderDomain("nobody@"), null);
	});
});

describe("matchesBlock", () => {
	const address: BlockEntry = { value: "spam@example.com", kind: "address" };
	const domain: BlockEntry = { value: "bad.org", kind: "domain" };

	test("matches an exact address case-insensitively", () => {
		assert.equal(matchesBlock("Spam@Example.com", [address]), address);
	});

	test("an address entry does not block others on the same domain", () => {
		assert.equal(matchesBlock("friend@example.com", [address]), null);
	});

	test("an address entry does not match on a substring", () => {
		assert.equal(matchesBlock("notspam@example.com", [address]), null);
		assert.equal(matchesBlock("spam@example.com.evil", [address]), null);
	});

	test("a domain entry blocks every address on that domain", () => {
		assert.equal(matchesBlock("anyone@bad.org", [domain]), domain);
	});

	test("a domain entry blocks subdomains", () => {
		assert.equal(matchesBlock("news@mail.bad.org", [domain]), domain);
	});

	test("a domain entry does not block lookalike domains", () => {
		assert.equal(matchesBlock("a@notbad.org", [domain]), null);
		assert.equal(matchesBlock("a@bad.org.example", [domain]), null);
	});

	test("a domain entry does not match the local part", () => {
		assert.equal(matchesBlock("bad.org@good.com", [domain]), null);
	});

	test("ignores missing senders", () => {
		assert.equal(matchesBlock("", [address, domain]), null);
		assert.equal(matchesBlock(null, [address, domain]), null);
		assert.equal(matchesBlock(undefined, [address, domain]), null);
	});

	test("returns null for an empty blocklist", () => {
		assert.equal(matchesBlock("spam@example.com", []), null);
	});

	test("guards against blocking the mailbox's own address or domain", () => {
		// toolBlockSender rejects an entry when matchesBlock(mailboxId, [entry]) hits.
		const mailbox = "me@company.com";
		assert.ok(matchesBlock(mailbox, [normalizeBlockEntry("me@company.com")]));
		assert.ok(matchesBlock(mailbox, [normalizeBlockEntry("company.com")]));
		assert.equal(matchesBlock(mailbox, [normalizeBlockEntry("other.com")]), null);
	});
});
