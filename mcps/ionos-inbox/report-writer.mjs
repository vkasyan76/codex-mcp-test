import fs from "node:fs/promises";
import path from "node:path";

const REPORT_SECTIONS = [
  {
    title: "Top Attention / Time-sensitive",
    filter: (result) => isTopAttention(result),
  },
  {
    title: "Needs Reply",
    filter: (result) => Boolean(result.needsReply),
  },
  {
    title: "Billing / Invoices",
    filter: (result) => result.category === "billing_invoice",
  },
  {
    title: "Customer / Support",
    filter: (result) => result.category === "customer_support",
  },
  {
    title: "Security / Account",
    filter: (result) => result.category === "account_security",
  },
  {
    title: "Business / Legal / Admin",
    filter: (result) =>
      ["business_opportunity", "legal_admin", "appointment_booking"].includes(result.category),
  },
  {
    title: "FYI / No Action",
    filter: (result) =>
      ["waiting_no_action", "newsletter_fyi", "automated_noise"].includes(result.category),
  },
  {
    title: "Suspicious / Spam",
    filter: (result) => result.category === "spam_suspicious",
  },
  {
    title: "Private / Personal",
    filter: (result) => result.category === "private_personal",
  },
  {
    title: "Unknown / Review Manually",
    filter: (result) => result.category === "unknown",
  },
];

function attentionScore(result) {
  return Number.isFinite(result.attentionScore) ? result.attentionScore : 0;
}

function receivedTime(result) {
  const parsed = Date.parse(result.email?.receivedAt || "");
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function isTopAttention(result) {
  return (
    attentionScore(result) >= 70 ||
    result.importance === "critical" ||
    result.importance === "high"
  );
}

function sortResults(results) {
  return [...results].sort((a, b) => {
    const scoreDiff = attentionScore(b) - attentionScore(a);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return receivedTime(b) - receivedTime(a);
  });
}

function formatTimestampForFile(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("-");
}

function markdownCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function csvCell(value) {
  const raw = String(value ?? "");
  const normalized = raw.replace(/\r?\n/g, " ");
  if (/[",\r\n]/.test(raw)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function buildTotals(results) {
  return {
    items: results.length,
    topAttention: results.filter(isTopAttention).length,
    needsReply: results.filter((result) => result.needsReply).length,
    highCritical: results.filter((result) =>
      ["critical", "high"].includes(result.importance)
    ).length,
    billingInvoices: results.filter((result) => result.category === "billing_invoice").length,
    securityAccount: results.filter((result) => result.category === "account_security").length,
    newsletterNoise: results.filter((result) =>
      ["newsletter_fyi", "automated_noise", "waiting_no_action"].includes(result.category)
    ).length,
    suspiciousFraud: results.filter((result) => result.category === "spam_suspicious").length,
  };
}

export function sourceReference(email) {
  return `mailboxId=${email.mailboxId} folder=${email.folder} uid=${email.uid} messageId=${email.messageId || "none"}`;
}

export function buildReportJson({ generatedAt, mailboxesChecked, results }) {
  const sortedResults = sortResults(results);
  return {
    generatedAt: generatedAt.toISOString(),
    mailboxesChecked,
    totals: buildTotals(results),
    items: sortedResults.map((result) => ({
      category: result.category,
      importance: result.importance,
      needsReply: Boolean(result.needsReply),
      hasDeadline: Boolean(result.hasDeadline),
      deadline: result.deadline || null,
      summary: result.summary,
      nextStep: result.nextStep,
      confidence: result.confidence,
      classifier: result.classifier,
      attentionScore: attentionScore(result),
      attentionReason: result.attentionReason || "",
      isUnread: Boolean(result.email?.isUnread),
      hasAttachments: Boolean(result.email?.hasAttachments),
      attachments: Array.isArray(result.email?.attachments) ? result.email.attachments : [],
      source: {
        mailboxId: result.email?.mailboxId,
        mailboxLabel: result.email?.mailboxLabel,
        folder: result.email?.folder,
        uid: result.email?.uid,
        messageId: result.email?.messageId || null,
        from: result.email?.from,
        subject: result.email?.subject,
        receivedAt: result.email?.receivedAt || null,
      },
    })),
  };
}

function buildTableRows(results) {
  return sortResults(results).map((result) =>
    [
      result.email?.mailboxLabel,
      attentionScore(result),
      result.attentionReason || "",
      result.category,
      result.email?.from,
      result.email?.subject,
      result.email?.receivedAt || "",
      result.importance,
      yesNo(result.needsReply),
      result.summary,
      result.nextStep,
      sourceReference(result.email),
    ]
      .map(markdownCell)
      .join(" | ")
      .replace(/^/, "| ")
      .replace(/$/, " |")
  );
}

function resultToReportRow(result) {
  return [
    result.email?.mailboxLabel,
    attentionScore(result),
    result.attentionReason || "",
    result.category,
    result.email?.from,
    result.email?.subject,
    result.email?.receivedAt || "",
    result.importance,
    yesNo(result.needsReply),
    result.summary,
    result.nextStep,
    sourceReference(result.email),
  ];
}

export function buildReportMarkdown({ generatedAt, mailboxesChecked, results }) {
  const totals = buildTotals(results);
  const lines = [
    `# Email Triage Report - ${generatedAt.toISOString()}`,
    "",
    "## Summary",
    "",
    `- Mailboxes checked: ${mailboxesChecked}`,
    `- Emails checked: ${totals.items}`,
    `- Top attention: ${totals.topAttention}`,
    `- Needs reply: ${totals.needsReply}`,
    `- High/Critical: ${totals.highCritical}`,
    `- Billing/Invoices: ${totals.billingInvoices}`,
    `- Security/Account: ${totals.securityAccount}`,
    `- Newsletter/Noise: ${totals.newsletterNoise}`,
    `- Suspicious/Fraud: ${totals.suspiciousFraud}`,
    "",
  ];

  for (const section of REPORT_SECTIONS) {
    const sectionItems = results.filter(section.filter);
    lines.push(`## ${section.title}`, "");

    if (!sectionItems.length) {
      lines.push("No items.", "");
      continue;
    }

    lines.push("| Mailbox | Score | Reason | Category | From | Subject | Received | Importance | Needs Reply | Summary | Next Step | Source |");
    lines.push("|---|---:|---|---|---|---|---|---|---|---|---|---|");
    lines.push(...buildTableRows(sectionItems));
    lines.push("");
  }

  return lines.join("\n");
}

export function buildReportCsv({ results }) {
  const header = [
    "Mailbox",
    "Score",
    "Reason",
    "Category",
    "From",
    "Subject",
    "Received",
    "Importance",
    "Needs Reply",
    "Summary",
    "Next Step",
    "Source",
  ];
  const rows = [header, ...sortResults(results).map(resultToReportRow)];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

export async function saveReport({ reportsDir, generatedAt = new Date(), mailboxesChecked, results }) {
  await fs.mkdir(reportsDir, { recursive: true });

  const baseName = `email-triage-${formatTimestampForFile(generatedAt)}`;
  const markdown = buildReportMarkdown({ generatedAt, mailboxesChecked, results });
  const json = buildReportJson({ generatedAt, mailboxesChecked, results });
  const csv = buildReportCsv({ generatedAt, mailboxesChecked, results });
  const markdownPath = path.join(reportsDir, `${baseName}.md`);
  const jsonPath = path.join(reportsDir, `${baseName}.json`);
  const csvPath = path.join(reportsDir, `${baseName}.csv`);
  const latestMarkdownPath = path.join(reportsDir, "latest.md");
  const latestJsonPath = path.join(reportsDir, "latest.json");
  const latestCsvPath = path.join(reportsDir, "latest.csv");

  await fs.writeFile(markdownPath, markdown, "utf8");
  await fs.writeFile(jsonPath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  await fs.writeFile(csvPath, csv, "utf8");
  await fs.writeFile(latestMarkdownPath, markdown, "utf8");
  await fs.writeFile(latestJsonPath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  await fs.writeFile(latestCsvPath, csv, "utf8");

  return {
    markdownPath,
    jsonPath,
    csvPath,
    latestMarkdownPath,
    latestJsonPath,
    latestCsvPath,
    markdown,
    json,
    csv,
  };
}
