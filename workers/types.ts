// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface Env extends Cloudflare.Env {
	POLICY_AUD: string;
	TEAM_DOMAIN: string;
	/**
	 * Optional shared secret allowing non-browser clients to call the API and
	 * MCP endpoints with `Authorization: Bearer <API_KEY>` instead of going
	 * through the interactive Cloudflare Access login. When unset, Access JWT
	 * validation remains the only way in.
	 */
	API_KEY?: string;
}
