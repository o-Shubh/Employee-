import nodemailer, { type Transporter } from "nodemailer";
import { prismaUnscoped as db } from "../db/client";

/**
 * Outbox mailer. Every email is first written to EmailMessage, then sent. Failed
 * sends are retried by the scheduler (up to MAX_ATTEMPTS).
 *
 *   SMTP_URL=smtp://user:pass@host:587   real delivery (Mailpit in docker-compose: smtp://mailpit:1025)
 *   no SMTP_URL (dev/test)               printed to the server log and marked sent
 *   no SMTP_URL (production)             left PENDING with a warning, so nothing is silently lost
 *   MAIL_TRANSPORT=log                   explicitly log instead of sending (demos, e2e tests)
 */
const MAX_ATTEMPTS = 5;
export const MAIL_FROM = process.env.MAIL_FROM ?? "WorkLog <no-reply@worklog.local>";

let transport: Transporter | null | undefined;
function getTransport(): Transporter | null {
  if (transport !== undefined) return transport;
  transport = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;
  return transport;
}

export interface OutgoingEmail {
  tenantId: string | null;
  to: string;
  subject: string;
  text: string;
}

async function attempt(id: string) {
  const msg = await db.emailMessage.findUnique({ where: { id } });
  if (!msg || msg.status === "SENT") return;
  const t = getTransport();
  if (!t) {
    if (process.env.NODE_ENV === "production" && process.env.MAIL_TRANSPORT !== "log") {
      console.warn(`[mail] SMTP_URL not set; email ${id} left pending`);
      return;
    }
    if (process.env.MAIL_LOG !== "0") console.info(`[mail] to=${msg.toEmail} subject="${msg.subject}"\n${msg.text}\n`);
    await db.emailMessage.update({ where: { id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } } });
    return;
  }
  try {
    await t.sendMail({ from: MAIL_FROM, to: msg.toEmail, subject: msg.subject, text: msg.text });
    await db.emailMessage.update({ where: { id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, lastError: null } });
  } catch (e) {
    await db.emailMessage.update({
      where: { id },
      data: { status: "FAILED", attempts: { increment: 1 }, lastError: String((e as Error).message).slice(0, 500) },
    });
  }
}

/** Record and send. Never throws: a mail failure must not fail the user's action. */
export async function sendEmails(emails: OutgoingEmail[]) {
  for (const e of emails) {
    try {
      const msg = await db.emailMessage.create({ data: { tenantId: e.tenantId, toEmail: e.to, subject: e.subject, text: e.text } });
      await attempt(msg.id);
    } catch (err) {
      console.error("[mail] could not queue email", err);
    }
  }
}

/** Retry pending/failed messages (called by the scheduler). */
export async function retryEmails() {
  const due = await db.emailMessage.findMany({
    where: { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: MAX_ATTEMPTS }, createdAt: { lt: new Date(Date.now() - 60_000) } },
    take: 100,
    orderBy: { createdAt: "asc" },
  });
  for (const m of due) await attempt(m.id);
  return due.length;
}

export const appUrl = (path = "/") => `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}${path}`;
