import { simpleParser } from "mailparser";

export function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function stripHtml(html) {
  return normalizeWhitespace(
    String(html ?? "")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#39;/gi, "'")
      .replace(/&quot;/gi, '"')
  );
}

export function trimToLength(value, maxChars) {
  const text = String(value ?? "");

  if (!Number.isInteger(maxChars) || maxChars <= 0) {
    return "";
  }
  if (text.length <= maxChars) {
    return text;
  }
  if (maxChars <= 3) {
    return ".".repeat(maxChars);
  }

  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
}

export function formatAddressList(addressList) {
  if (!addressList?.value?.length) {
    return "Unknown sender";
  }

  return addressList.value
    .map((entry) => {
      if (entry.name && entry.address) {
        return `${entry.name} <${entry.address}>`;
      }
      return entry.address || entry.name || "Unknown sender";
    })
    .join(", ");
}

export function formatAddressArray(addressList) {
  return addressList?.value
    ?.map((entry) => entry.address || entry.name)
    .filter(Boolean) || [];
}

export function resolveMessageFlags(rawMessage) {
  if (Array.isArray(rawMessage.flags)) {
    return rawMessage.flags;
  }

  return [...(rawMessage.flags || [])];
}

export function resolveMessageDate(parsed, rawMessage) {
  return parsed.date?.toISOString() || rawMessage.envelope?.date?.toISOString() || null;
}

export function resolveMessageFolder(mailboxConfig) {
  return mailboxConfig.folder || mailboxConfig.mailbox || "INBOX";
}

export async function normalizeRawMessage(rawMessage, mailboxConfig) {
  if (!rawMessage?.source) {
    throw new Error("normalizeRawMessage requires rawMessage.source");
  }
  if (!Number.isInteger(rawMessage.uid) || rawMessage.uid <= 0) {
    throw new Error("normalizeRawMessage requires a positive integer rawMessage.uid");
  }

  const parsed = await simpleParser(rawMessage.source);
  const textSource = parsed.text || stripHtml(parsed.html || "");
  const maxBodyChars = Number.isInteger(mailboxConfig.maxBodyChars)
    ? mailboxConfig.maxBodyChars
    : 4000;
  const body = trimToLength(
    normalizeWhitespace(textSource || ""),
    maxBodyChars
  );
  const flags = resolveMessageFlags(rawMessage);

  return {
    mailboxId: mailboxConfig.id,
    mailboxLabel: mailboxConfig.label,
    mailboxType: mailboxConfig.type,
    mailboxEmail: mailboxConfig.email,
    folder: resolveMessageFolder(mailboxConfig),
    uid: rawMessage.uid,
    messageId: parsed.messageId || null,
    from: formatAddressList(parsed.from),
    to: formatAddressArray(parsed.to),
    cc: formatAddressArray(parsed.cc),
    subject: normalizeWhitespace(parsed.subject || "(no subject)"),
    receivedAt: resolveMessageDate(parsed, rawMessage),
    isUnread: !flags.includes("\\Seen"),
    preview: trimToLength(body, 240),
    body,
    hasAttachments: Boolean(parsed.attachments?.length),
    attachments:
      parsed.attachments?.map((attachment) => attachment.filename).filter(Boolean) || [],
  };
}
