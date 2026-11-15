// mail.ts — Outgoing mail for sign-in links and invitations.
//   file   — writes each message as JSON to `<dataDir>/outbox/` (local runs and
//            E2E read the link from there; nothing leaves the machine).
//   resend — Resend's HTTP API (production).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ServerConfig } from './config';
import { trace } from './trace';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Machine-readable payload kept by the file transport (e.g. the sign-in link). */
  meta?: Record<string, string>;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export function createMailer(config: ServerConfig): Mailer {
  if (config.mailTransport === 'resend') {
    return {
      async send(message) {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: config.mailFrom, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`Resend refused the message (${response.status}): ${body.slice(0, 300)}`);
        }
        trace.action('mail:sent', { transport: 'resend', to: message.to, subject: message.subject });
      },
    };
  }

  const outbox = path.join(config.dataDir, 'outbox');
  return {
    async send(message) {
      fs.mkdirSync(outbox, { recursive: true, mode: 0o700 });
      const file = path.join(outbox, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`);
      fs.writeFileSync(file, JSON.stringify({ ...message, sentAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
      trace.action('mail:sent', { transport: 'file', to: message.to, subject: message.subject, file });
    },
  };
}
