import path from "node:path";

import { z } from "zod";

export const PROFILE_SCHEMA = z.enum(["business", "private"]);
export const MAILBOX_TYPE_SCHEMA = z.enum([
  "company",
  "private",
  "support",
  "accounting",
  "system",
  "other",
]);

function booleanFromString(defaultValue) {
  return z
    .string()
    .default(defaultValue ? "true" : "false")
    .transform((value) => value.toLowerCase() !== "false");
}

export const ENV_SCHEMA = z.object({
  MAIL_DEFAULT_PROFILE: PROFILE_SCHEMA.default("private"),
  MAIL_MAILBOX: z.string().min(1).default("INBOX"),
  MAIL_MAX_BODY_CHARS: z.coerce.number().int().positive().default(4000),
  MAIL_TLS_REJECT_UNAUTHORIZED: booleanFromString(true),
  MAIL_REPORTS_DIR: z.string().min(1).default("../../reports"),

  MAIL_EMAIL_BUSINESS: z.string().min(1).optional(),
  MAIL_PASSWORD_BUSINESS: z.string().min(1).optional(),
  MAIL_IMAP_HOST_BUSINESS: z.string().min(1).default("imap.ionos.de"),
  MAIL_IMAP_PORT_BUSINESS: z.coerce.number().int().positive().default(993),
  MAIL_IMAP_SECURE_BUSINESS: booleanFromString(true),

  MAIL_EMAIL_PRIVATE: z.string().min(1).optional(),
  MAIL_PASSWORD_PRIVATE: z.string().min(1).optional(),
  MAIL_IMAP_HOST_PRIVATE: z.string().min(1).default("imap.gmx.net"),
  MAIL_IMAP_PORT_PRIVATE: z.coerce.number().int().positive().default(993),
  MAIL_IMAP_SECURE_PRIVATE: booleanFromString(true),
});

export function loadConfigFromEnv(env = process.env) {
  return ENV_SCHEMA.parse(env);
}

function requireLegacyCredential(value, key, profile) {
  if (value) {
    return value;
  }

  throw new Error(`Legacy mailbox profile ${profile} is missing ${key}`);
}

export function resolveMailboxProfile(config, requestedProfile) {
  const profile = requestedProfile || config.MAIL_DEFAULT_PROFILE;
  const shared = {
    profile,
    mailbox: config.MAIL_MAILBOX,
    maxBodyChars: config.MAIL_MAX_BODY_CHARS,
    tlsRejectUnauthorized: config.MAIL_TLS_REJECT_UNAUTHORIZED,
  };

  if (profile === "business") {
    return {
      ...shared,
      email: requireLegacyCredential(config.MAIL_EMAIL_BUSINESS, "MAIL_EMAIL_BUSINESS", profile),
      password: requireLegacyCredential(
        config.MAIL_PASSWORD_BUSINESS,
        "MAIL_PASSWORD_BUSINESS",
        profile
      ),
      host: config.MAIL_IMAP_HOST_BUSINESS,
      port: config.MAIL_IMAP_PORT_BUSINESS,
      secure: config.MAIL_IMAP_SECURE_BUSINESS,
    };
  }

  return {
    ...shared,
    email: requireLegacyCredential(config.MAIL_EMAIL_PRIVATE, "MAIL_EMAIL_PRIVATE", profile),
    password: requireLegacyCredential(
      config.MAIL_PASSWORD_PRIVATE,
      "MAIL_PASSWORD_PRIVATE",
      profile
    ),
    host: config.MAIL_IMAP_HOST_PRIVATE,
    port: config.MAIL_IMAP_PORT_PRIVATE,
    secure: config.MAIL_IMAP_SECURE_PRIVATE,
  };
}

function envKeyForMailbox(id, suffix) {
  return `MAILBOX_${id.toUpperCase()}_${suffix}`;
}

function readString(env, key, fallback) {
  const value = env[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return fallback;
}

function readBoolean(env, key, fallback) {
  const value = readString(env, key);
  if (value === undefined) {
    return fallback;
  }
  return value.toLowerCase() !== "false";
}

function readInteger(env, key, fallback) {
  const value = readString(env, key);
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveConfiguredMailboxes(config, env = process.env) {
  const ids = readString(env, "MAILBOXES", "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  return ids.map((id) => resolveConfiguredMailbox(config, id, env));
}

export function resolveConfiguredMailbox(config, id, env = process.env) {
  const label = readString(env, envKeyForMailbox(id, "LABEL"), id);
  const type = MAILBOX_TYPE_SCHEMA.parse(
    readString(env, envKeyForMailbox(id, "TYPE"), "other")
  );
  const email = readString(env, envKeyForMailbox(id, "EMAIL"));
  const password = readString(env, envKeyForMailbox(id, "PASSWORD"));
  const host = readString(env, envKeyForMailbox(id, "IMAP_HOST"));
  const port = readInteger(env, envKeyForMailbox(id, "IMAP_PORT"), 993);
  const secure = readBoolean(env, envKeyForMailbox(id, "IMAP_SECURE"), true);
  const folder = readString(env, envKeyForMailbox(id, "FOLDER"), config.MAIL_MAILBOX);

  if (!email || !password || !host) {
    throw new Error(`Mailbox ${id} is missing EMAIL, PASSWORD, or IMAP_HOST`);
  }

  return {
    id,
    profile: id,
    label,
    type,
    email,
    password,
    host,
    port,
    secure,
    folder,
    mailbox: folder,
    maxBodyChars: config.MAIL_MAX_BODY_CHARS,
    tlsRejectUnauthorized: config.MAIL_TLS_REJECT_UNAUTHORIZED,
  };
}

export function maskEmail(email) {
  const [localPart, domain] = String(email || "").split("@");
  if (!localPart || !domain) {
    return "";
  }

  return `${localPart.slice(0, 1)}***@${domain}`;
}

export function toSafeMailboxMetadata(mailbox, { includeEmail = false } = {}) {
  const metadata = {
    id: mailbox.id,
    label: mailbox.label,
    type: mailbox.type,
    maskedEmail: maskEmail(mailbox.email),
    host: mailbox.host,
    folder: mailbox.folder,
  };

  if (includeEmail) {
    metadata.email = mailbox.email;
  }

  return metadata;
}

export function resolveReportsDir(config, baseDir) {
  return path.resolve(baseDir, config.MAIL_REPORTS_DIR);
}

export function buildImapClientOptions(mailboxProfile) {
  return {
    host: mailboxProfile.host,
    port: mailboxProfile.port,
    secure: mailboxProfile.secure,
    auth: {
      user: mailboxProfile.email,
      pass: mailboxProfile.password,
    },
    tls: {
      rejectUnauthorized: mailboxProfile.tlsRejectUnauthorized,
    },
    logger: false,
  };
}
