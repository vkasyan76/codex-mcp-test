import assert from "node:assert/strict";
import test from "node:test";

import {
  createFetchOptions,
  createMailboxOpenOptions,
  listRecentRawMessages,
  listUnreadRawMessages,
  normalizeUidList,
  readRawMessageByUid,
  resolveFolder,
  withMailbox,
} from "../imap-reader.mjs";

const BASE_MAILBOX = {
  id: "info",
  label: "Info",
  type: "company",
  email: "info@example.com",
  password: "password",
  host: "imap.example.com",
  port: 993,
  secure: true,
  folder: "INBOX",
  mailbox: "INBOX",
  maxBodyChars: 4000,
  tlsRejectUnauthorized: true,
};

function createFakeImapFlowClass({ searchResult = [], fetchMessages = [] } = {}) {
  const instances = [];

  class FakeImapFlow {
    constructor(options) {
      this.options = options;
      this.calls = [];
      instances.push(this);
    }

    async connect() {
      this.calls.push(["connect"]);
    }

    async mailboxOpen(folder, options) {
      this.calls.push(["mailboxOpen", folder, options]);
    }

    async search(query, options) {
      this.calls.push(["search", query, options]);
      return searchResult;
    }

    async *fetch(uids, fetchOptions, options) {
      this.calls.push(["fetch", uids, fetchOptions, options]);

      for (const message of fetchMessages) {
        yield message;
      }
    }

    async logout() {
      this.calls.push(["logout"]);
    }
  }

  return { FakeImapFlow, instances };
}

test("normalizes uid lists newest first", () => {
  assert.deepEqual(normalizeUidList([5, 2, 9, 1]), [9, 5, 2, 1]);
});

test("normalizes uid lists with a positive limit", () => {
  assert.deepEqual(normalizeUidList([5, 2, 9, 1], 3), [9, 5, 2]);
});

test("normalizes uid lists without limiting when limit is omitted or invalid", () => {
  assert.deepEqual(normalizeUidList([1, 2, 3], undefined), [3, 2, 1]);
  assert.deepEqual(normalizeUidList([1, 2, 3], 0), [3, 2, 1]);
  assert.deepEqual(normalizeUidList([1, 2, 3], -1), [3, 2, 1]);
});

test("fetch options request source, envelope, flags, and uid", () => {
  assert.deepEqual(createFetchOptions(), {
    envelope: true,
    source: true,
    flags: true,
    uid: true,
  });
});

test("mailbox open options are read-only", () => {
  assert.deepEqual(createMailboxOpenOptions(), { readOnly: true });
});

test("resolves folders from explicit input, configured folder, legacy mailbox, or INBOX", () => {
  assert.equal(resolveFolder({ folder: "Configured", mailbox: "Legacy" }, "Explicit"), "Explicit");
  assert.equal(resolveFolder({ folder: "Configured", mailbox: "Legacy" }), "Configured");
  assert.equal(resolveFolder({ mailbox: "Legacy" }), "Legacy");
  assert.equal(resolveFolder({}), "INBOX");
});

test("withMailbox opens the resolved folder read-only and logs out on success", async () => {
  const { FakeImapFlow, instances } = createFakeImapFlowClass();

  const result = await withMailbox(
    BASE_MAILBOX,
    "Archive",
    async () => "ok",
    { ImapFlowClass: FakeImapFlow }
  );

  assert.equal(result, "ok");
  assert.deepEqual(instances[0].calls, [
    ["connect"],
    ["mailboxOpen", "Archive", { readOnly: true }],
    ["logout"],
  ]);
});

test("withMailbox logs out when callback throws", async () => {
  const { FakeImapFlow, instances } = createFakeImapFlowClass();

  await assert.rejects(
    () =>
      withMailbox(
        BASE_MAILBOX,
        "Archive",
        async () => {
          throw new Error("callback failed");
        },
        { ImapFlowClass: FakeImapFlow }
      ),
    /callback failed/
  );

  assert.deepEqual(instances[0].calls, [
    ["connect"],
    ["mailboxOpen", "Archive", { readOnly: true }],
    ["logout"],
  ]);
});

test("withMailbox passes the resolved folder into the callback mailbox config", async () => {
  const { FakeImapFlow } = createFakeImapFlowClass();

  const callbackMailbox = await withMailbox(
    { ...BASE_MAILBOX, folder: "Configured" },
    undefined,
    async (_client, mailbox) => mailbox,
    { ImapFlowClass: FakeImapFlow }
  );

  assert.equal(callbackMailbox.folder, "Configured");
});

test("listUnreadRawMessages searches unread uids and fetches newest selected messages", async () => {
  const fetchMessages = [{ uid: 9 }, { uid: 5 }];
  const { FakeImapFlow, instances } = createFakeImapFlowClass({
    searchResult: [5, 2, 9, 1],
    fetchMessages,
  });

  const messages = await listUnreadRawMessages(
    BASE_MAILBOX,
    { folder: "INBOX", limit: 2 },
    { ImapFlowClass: FakeImapFlow }
  );

  assert.deepEqual(messages, fetchMessages);
  assert.deepEqual(instances[0].calls, [
    ["connect"],
    ["mailboxOpen", "INBOX", { readOnly: true }],
    ["search", { seen: false }, { uid: true }],
    ["fetch", [9, 5], createFetchOptions(), { uid: true }],
    ["logout"],
  ]);
});

test("listRecentRawMessages searches recent uids with optional unread filter", async () => {
  const since = new Date("2026-05-31T10:00:00.000Z");
  const { FakeImapFlow, instances } = createFakeImapFlowClass({
    searchResult: [3, 7],
    fetchMessages: [{ uid: 7 }],
  });

  const messages = await listRecentRawMessages(
    BASE_MAILBOX,
    { folder: "INBOX", since, limit: 1, unreadOnly: true },
    { ImapFlowClass: FakeImapFlow }
  );

  assert.deepEqual(messages, [{ uid: 7 }]);
  assert.deepEqual(instances[0].calls, [
    ["connect"],
    ["mailboxOpen", "INBOX", { readOnly: true }],
    ["search", { since, seen: false }, { uid: true }],
    ["fetch", [7], createFetchOptions(), { uid: true }],
    ["logout"],
  ]);
});

test("listRecentRawMessages requires a valid since date", async () => {
  const { FakeImapFlow, instances } = createFakeImapFlowClass();

  await assert.rejects(
    () => listRecentRawMessages(BASE_MAILBOX, {}, { ImapFlowClass: FakeImapFlow }),
    /requires a valid since Date/
  );

  await assert.rejects(
    () =>
      listRecentRawMessages(
        BASE_MAILBOX,
        { since: new Date("invalid") },
        { ImapFlowClass: FakeImapFlow }
      ),
    /requires a valid since Date/
  );

  assert.equal(instances.length, 0);
});

test("readRawMessageByUid accepts folder and uid", async () => {
  const { FakeImapFlow, instances } = createFakeImapFlowClass({
    fetchMessages: [{ uid: 42, source: Buffer.from("message") }],
  });

  const message = await readRawMessageByUid(
    BASE_MAILBOX,
    { folder: "Archive", uid: 42 },
    { ImapFlowClass: FakeImapFlow }
  );

  assert.equal(message.uid, 42);
  assert.deepEqual(instances[0].calls, [
    ["connect"],
    ["mailboxOpen", "Archive", { readOnly: true }],
    ["fetch", [42], createFetchOptions(), { uid: true }],
    ["logout"],
  ]);
});

test("readRawMessageByUid requires a positive integer uid", async () => {
  const { FakeImapFlow, instances } = createFakeImapFlowClass();

  await assert.rejects(
    () =>
      readRawMessageByUid(
        BASE_MAILBOX,
        { folder: "Archive" },
        { ImapFlowClass: FakeImapFlow }
      ),
    /requires a positive integer uid/
  );

  await assert.rejects(
    () =>
      readRawMessageByUid(
        BASE_MAILBOX,
        { folder: "Archive", uid: 0 },
        { ImapFlowClass: FakeImapFlow }
      ),
    /requires a positive integer uid/
  );

  assert.equal(instances.length, 0);
});
