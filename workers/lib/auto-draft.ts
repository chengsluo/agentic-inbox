// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Whether the agent should automatically draft a reply when new mail arrives
 * for a mailbox. Off unless the mailbox explicitly opted in, so mailboxes
 * created before this setting existed don't draft either.
 *
 * Only gates the automatic trigger: the agent chat and MCP `draft_reply` tool
 * still work on request.
 */
export function isAutoDraftEnabled(settings: unknown): boolean {
	if (!settings || typeof settings !== "object") return false;
	const autoDraft = (settings as { autoDraft?: unknown }).autoDraft;
	if (!autoDraft || typeof autoDraft !== "object") return false;
	return (autoDraft as { enabled?: unknown }).enabled === true;
}
