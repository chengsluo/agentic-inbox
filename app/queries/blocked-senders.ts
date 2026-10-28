// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { BlockedSender } from "~/types";
import { queryKeys } from "./keys";

export function useBlockedSenders(mailboxId: string | undefined) {
	return useQuery<BlockedSender[]>({
		queryKey: mailboxId
			? queryKeys.blockedSenders.list(mailboxId)
			: ["blocked-senders", "_disabled"],
		queryFn: () => api.listBlockedSenders(mailboxId!),
		enabled: !!mailboxId,
	});
}

export function useBlockSender() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, value }: { mailboxId: string; value: string }) =>
			api.blockSender(mailboxId, value),
		onSuccess: (_data, { mailboxId }) => {
			// Blocking purges existing mail, so every email view may be stale.
			qc.invalidateQueries({ queryKey: queryKeys.blockedSenders.list(mailboxId) });
			qc.invalidateQueries({ queryKey: ["emails", mailboxId] });
			qc.invalidateQueries({ queryKey: ["search", mailboxId] });
			qc.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
		},
	});
}

export function useUnblockSender() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, value }: { mailboxId: string; value: string }) =>
			api.unblockSender(mailboxId, value),
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: queryKeys.blockedSenders.list(mailboxId) });
		},
	});
}
