// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Input, Loader, useKumoToastManager } from "@cloudflare/kumo";
import { ProhibitIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useBlockedSenders, useBlockSender, useUnblockSender } from "~/queries/blocked-senders";

/**
 * Settings card for the per-mailbox sender blocklist. Saves independently of
 * the page's "Save Changes" button since blocking takes effect immediately.
 */
export default function BlockedSendersSettings({ mailboxId }: { mailboxId: string }) {
	const toastManager = useKumoToastManager();
	const { data: blocked = [], isLoading } = useBlockedSenders(mailboxId);
	const blockMutation = useBlockSender();
	const unblockMutation = useUnblockSender();
	const [value, setValue] = useState("");

	const handleBlock = async () => {
		const target = value.trim();
		if (!target) return;
		if (!window.confirm(
			`Block ${target}?\n\nAll existing emails from this sender will be permanently deleted, and new emails from it will be discarded on arrival.`,
		)) return;
		try {
			const { entry, deletedCount } = await blockMutation.mutateAsync({ mailboxId, value: target });
			setValue("");
			toastManager.add({
				title: `Blocked ${entry.value}`,
				description: deletedCount > 0 ? `Deleted ${deletedCount} existing email${deletedCount === 1 ? "" : "s"}.` : undefined,
			});
		} catch (err) {
			toastManager.add({
				title: (err instanceof Error && err.message) || "Failed to block sender",
				variant: "error",
			});
		}
	};

	const handleUnblock = (entryValue: string) => {
		unblockMutation.mutate(
			{ mailboxId, value: entryValue },
			{
				onSuccess: () => toastManager.add({ title: `Unblocked ${entryValue}` }),
				onError: () => toastManager.add({ title: "Failed to unblock sender", variant: "error" }),
			},
		);
	};

	return (
		<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
			<div className="flex items-center gap-2 mb-4">
				<ProhibitIcon size={16} weight="duotone" className="text-kumo-subtle" />
				<span className="text-sm font-medium text-kumo-default">Blocked Senders</span>
				{blocked.length > 0 && <Badge variant="secondary">{blocked.length}</Badge>}
			</div>
			<p className="text-xs text-kumo-subtle mb-3">
				Block an address (<span className="font-mono">spam@example.com</span>) or a whole
				domain (<span className="font-mono">example.com</span>, including its subdomains).
				Existing emails from blocked senders are permanently deleted, and new ones are
				discarded on arrival. Unblocking does not restore deleted emails.
			</p>
			<form
				className="flex items-end gap-2"
				onSubmit={(e) => { e.preventDefault(); handleBlock(); }}
			>
				<div className="flex-1">
					<Input
						aria-label="Address or domain to block"
						placeholder="spam@example.com or example.com"
						value={value}
						onChange={(e) => setValue(e.target.value)}
					/>
				</div>
				<Button
					type="submit"
					variant="secondary"
					loading={blockMutation.isPending}
					disabled={!value.trim()}
				>
					Block
				</Button>
			</form>

			<div className="mt-4">
				{isLoading ? (
					<div className="flex justify-center py-4"><Loader /></div>
				) : blocked.length === 0 ? (
					<p className="text-xs text-kumo-subtle text-center py-3">No blocked senders.</p>
				) : (
					<div className="border border-kumo-line rounded-lg divide-y divide-kumo-line">
						{blocked.map((entry) => (
							<div key={entry.value} className="flex items-center gap-2.5 px-3 py-2">
								<span className="min-w-0 flex-1 truncate text-sm font-mono text-kumo-default">
									{entry.kind === "domain" ? `@${entry.value}` : entry.value}
								</span>
								<Badge variant="secondary">{entry.kind === "domain" ? "Domain" : "Address"}</Badge>
								<Button
									variant="ghost"
									shape="square"
									size="xs"
									icon={<XIcon size={14} />}
									onClick={() => handleUnblock(entry.value)}
									disabled={unblockMutation.isPending && unblockMutation.variables?.value === entry.value}
									aria-label={`Unblock ${entry.value}`}
								/>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
