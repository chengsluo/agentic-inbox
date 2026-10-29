// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Tests for persisting the SMTP envelope sender (event.from) alongside the
 * MIME From: header: normalization, and the in-place schema migration.
 *
 * Run with:  npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { normalizeEnvelopeSender } from "../workers/lib/envelope.ts";
import { applyMigrations, mailboxMigrations } from "../workers/durableObject/migrations.ts";

describe("normalizeEnvelopeSender", () => {
	test("trims and lowercases", () => {
		assert.equal(normalizeEnvelopeSender("  Sender@Example.com "), "sender@example.com");
	});

	test("maps a missing or null reverse-path to null", () => {
		assert.equal(normalizeEnvelopeSender(undefined), null);
		assert.equal(normalizeEnvelopeSender(null), null);
		assert.equal(normalizeEnvelopeSender(""), null);
		assert.equal(normalizeEnvelopeSender("   "), null);
		assert.equal(normalizeEnvelopeSender("<>"), null);
	});
});

// Minimal stand-in for the Durable Object SqlStorage API on top of node:sqlite.
function sqlStorage(db: DatabaseSync) {
	return {
		exec(query: string, ...params: unknown[]) {
			if (params.length > 0) return db.prepare(query).all(...(params as any[]));
			db.exec(query);
			return [];
		},
	} as unknown as SqlStorage;
}

const columns = (db: DatabaseSync) =>
	(db.prepare("PRAGMA table_info(emails)").all() as { name: string }[]).map((c) => c.name);

describe("10_add_envelope_sender migration", () => {
	test("fresh mailbox gets the column", () => {
		const db = new DatabaseSync(":memory:");
		applyMigrations(sqlStorage(db), mailboxMigrations);
		assert.ok(columns(db).includes("envelope_sender"));
	});

	test("upgrades an existing mailbox in place, keeping legacy rows intact with NULL", () => {
		const db = new DatabaseSync(":memory:");
		const sql = sqlStorage(db);
		const legacy = mailboxMigrations.filter((m) => m.name !== "10_add_envelope_sender");
		applyMigrations(sql, legacy);
		assert.ok(!columns(db).includes("envelope_sender"));

		const row = {
			id: "legacy-1", folder_id: "inbox", subject: "Hello", sender: "other@example.com",
			recipient: "me@example.com", date: "2026-01-01T00:00:00.000Z", read: 1, starred: 1,
			body: "<p>body</p>", in_reply_to: "a@b", email_references: '["a@b"]', thread_id: "a@b",
			message_id: "m@b", raw_headers: '[{"key":"from","value":"other@example.com"}]',
			cc: "cc@example.com", bcc: null,
		};
		const keys = Object.keys(row);
		db.prepare(`INSERT INTO emails (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
			.run(...(Object.values(row) as any[]));

		applyMigrations(sql, mailboxMigrations);
		// Re-running is a no-op.
		applyMigrations(sql, mailboxMigrations);

		const after = db.prepare("SELECT * FROM emails WHERE id = ?").get("legacy-1") as Record<string, unknown>;
		assert.deepEqual({ ...after }, { ...row, envelope_sender: null });
	});

	test("stores envelope sender separately from the MIME From: sender", () => {
		const db = new DatabaseSync(":memory:");
		applyMigrations(sqlStorage(db), mailboxMigrations);
		db.prepare("INSERT INTO emails (id, folder_id, sender, envelope_sender) VALUES (?, 'inbox', ?, ?)")
			.run("new-1", "other@example.com", normalizeEnvelopeSender("Sender@Example.com"));
		const after = db.prepare("SELECT sender, envelope_sender FROM emails WHERE id = ?").get("new-1") as any;
		assert.equal(after.sender, "other@example.com");
		assert.equal(after.envelope_sender, "sender@example.com");
	});
});
