import { ImapFlow } from "imapflow";

import { buildImapClientOptions } from "./mailbox-config.mjs";

export function normalizeUidList(uids, limit) {
  const sorted = [...uids].sort((a, b) => b - a);

  if (!Number.isInteger(limit) || limit <= 0) {
    return sorted;
  }

  return sorted.slice(0, limit);
}

export function createFetchOptions() {
  return {
    envelope: true,
    source: true,
    flags: true,
    uid: true,
  };
}

export function createMailboxOpenOptions() {
  return { readOnly: true };
}

export function resolveFolder(mailboxConfig, folder) {
  return folder || mailboxConfig.folder || mailboxConfig.mailbox || "INBOX";
}

export async function withMailbox(
  mailboxConfig,
  folder,
  callback,
  { ImapFlowClass = ImapFlow } = {}
) {
  const resolvedFolder = resolveFolder(mailboxConfig, folder);
  const client = new ImapFlowClass(buildImapClientOptions(mailboxConfig));

  try {
    await client.connect();
    await client.mailboxOpen(resolvedFolder, createMailboxOpenOptions());
    return await callback(client, { ...mailboxConfig, folder: resolvedFolder });
  } finally {
    await client.logout().catch(() => {});
  }
}

async function fetchMessagesByUid(client, uids) {
  const messages = [];

  if (!uids.length) {
    return messages;
  }

  for await (const message of client.fetch(uids, createFetchOptions(), { uid: true })) {
    messages.push(message);
  }

  return messages;
}

export async function listUnreadRawMessages(
  mailboxConfig,
  { folder, limit } = {},
  options = {}
) {
  return withMailbox(
    mailboxConfig,
    folder,
    async (client) => {
      const unreadUids = await client.search({ seen: false }, { uid: true });
      const selectedUids = normalizeUidList(unreadUids, limit);
      return fetchMessagesByUid(client, selectedUids);
    },
    options
  );
}

export async function listRecentRawMessages(
  mailboxConfig,
  { folder, since, limit, unreadOnly = false } = {},
  options = {}
) {
  if (!(since instanceof Date) || Number.isNaN(since.getTime())) {
    throw new Error("listRecentRawMessages requires a valid since Date");
  }

  return withMailbox(
    mailboxConfig,
    folder,
    async (client) => {
      const searchQuery = unreadOnly ? { since, seen: false } : { since };
      const uids = await client.search(searchQuery, { uid: true });
      const selectedUids = normalizeUidList(uids, limit);
      return fetchMessagesByUid(client, selectedUids);
    },
    options
  );
}

export async function readRawMessageByUid(
  mailboxConfig,
  { folder, uid },
  options = {}
) {
  if (!Number.isInteger(uid) || uid <= 0) {
    throw new Error("readRawMessageByUid requires a positive integer uid");
  }

  return withMailbox(
    mailboxConfig,
    folder,
    async (client) => {
      for await (const message of client.fetch([uid], createFetchOptions(), { uid: true })) {
        return message;
      }

      return null;
    },
    options
  );
}
