import { randomInt } from 'node:crypto';

/**
 * Transactional email + email-verification helpers.
 *
 * Provider: Resend (HTTP API — no dependency, just `fetch`). Verification is only REQUIRED when
 * we can actually deliver a code: `RESEND_API_KEY` is set, or `EMAIL_DEV_LOG=1` for local testing
 * (which logs the code to the server instead of sending). This makes the feature self-protecting —
 * the live site keeps instant signup until email is wired, so no one is ever locked out mid-deploy.
 */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function emailVerificationRequired(): boolean {
  return emailConfigured() || process.env.EMAIL_DEV_LOG === '1';
}

function fromAddress(): string {
  return process.env.RESEND_FROM ?? 'SuperCharts <onboarding@resend.dev>';
}

/** A zero-padded 6-digit numeric code. */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Send the verification code. Returns true if it was delivered (or dev-logged). Never throws —
 * a send failure must not roll back the just-created account; the user can request a resend.
 */
export async function sendVerificationEmail(to: string, code: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.EMAIL_DEV_LOG === '1') {

      console.log(`[email:dev] verification code for ${to}: ${code}`);
      return true;
    }
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: fromAddress(),
        to: [to],
        subject: `Your SuperCharts verification code: ${code}`,
        text: `Your SuperCharts verification code is ${code}. It expires in 15 minutes.\n\nIf you didn't create a SuperCharts account, you can ignore this email.`,
        html: verificationHtml(code),
      }),
    });
    if (!res.ok) {

      console.error(`[email] resend send failed: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {

    console.error('[email] resend send error', err);
    return false;
  }
}

/**
 * Send a password-reset link. Returns true if delivered (or dev-logged). Never throws — a send
 * failure must not reveal to the caller whether the address exists (the route stays generic).
 */
export async function sendPasswordResetEmail(to: string, link: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.EMAIL_DEV_LOG === '1') {

      console.log(`[email:dev] password reset link for ${to}: ${link}`);
      return true;
    }
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: fromAddress(),
        to: [to],
        subject: 'Reset your SuperCharts password',
        text: `Someone asked to reset the password for your SuperCharts account.\n\nReset it here (link expires in 30 minutes):\n${link}\n\nIf you didn't request this, you can safely ignore this email — your password won't change.`,
        html: resetHtml(link),
      }),
    });
    if (!res.ok) {

      console.error(`[email] resend reset send failed: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {

    console.error('[email] resend reset send error', err);
    return false;
  }
}

function resetHtml(link: string): string {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">Reset your password</h2>
  <p style="color:#475569;margin:0 0 20px">Someone asked to reset the password for your SuperCharts account. Click below to choose a new one:</p>
  <a href="${link}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:600">Reset password</a>
  <p style="color:#94a3b8;font-size:13px;margin:20px 0 0">This link expires in 30 minutes. If you didn't request it, ignore this email — your password won't change.</p>
</div>`;
}

function verificationHtml(code: string): string {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">Verify your email</h2>
  <p style="color:#475569;margin:0 0 20px">Enter this code to finish setting up your SuperCharts account:</p>
  <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#0f172a;color:#fff;padding:16px;border-radius:12px;text-align:center">${code}</div>
  <p style="color:#94a3b8;font-size:13px;margin:20px 0 0">This code expires in 15 minutes. If you didn't sign up, you can ignore this email.</p>
</div>`;
}
