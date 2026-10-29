// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Tests for the per-mailbox auto-draft opt-in.
 *
 * Run with:  npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { isAutoDraftEnabled } from "../workers/lib/auto-draft.ts";

describe("isAutoDraftEnabled", () => {
	test("is on only when explicitly enabled", () => {
		assert.equal(isAutoDraftEnabled({ autoDraft: { enabled: true } }), true);
		assert.equal(isAutoDraftEnabled({ autoDraft: { enabled: false } }), false);
	});

	test("defaults to off for mailboxes without the setting", () => {
		assert.equal(isAutoDraftEnabled({ fromName: "Inbox" }), false);
		assert.equal(isAutoDraftEnabled({}), false);
		assert.equal(isAutoDraftEnabled(null), false);
		assert.equal(isAutoDraftEnabled(undefined), false);
	});

	test("ignores malformed values", () => {
		assert.equal(isAutoDraftEnabled({ autoDraft: true }), false);
		assert.equal(isAutoDraftEnabled({ autoDraft: { enabled: "true" } }), false);
		assert.equal(isAutoDraftEnabled("autoDraft"), false);
	});
});
