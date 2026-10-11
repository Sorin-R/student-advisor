let transporter
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])) }
export function assertEmailConfiguration(env = process.env) {
  if (!env.SMTP_HOST || !env.EMAIL_FROM) throw new Error('SMTP_HOST and EMAIL_FROM must be configured for account verification and recovery')
}
async function mailTransporter() {
  assertEmailConfiguration()
  if (!transporter) {
    const { default: nodemailer } = await import('nodemailer')
    transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', requireTLS: process.env.SMTP_SECURE !== 'true', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined })
  }
  return transporter
}
async function send({ email, subject, text, html }) { await (await mailTransporter()).sendMail({ from: process.env.EMAIL_FROM, to: email, subject, text, html }); return true }
export function sendSupportMessageEmail({ id, name, email, topic, message }) {
  const reference = id.replaceAll('-', '').slice(0, 8).toUpperCase()
  const subject = `Student Advisor enquiry [${reference}] ${topic}`
  const text = `New support message from ${name}\nEmail: ${email}\nTopic: ${topic}\nReference: ${reference}\n\n${message}`
  const html = `<p><strong>New support message from ${escapeHtml(name)}</strong></p><p>Email: ${escapeHtml(email)}<br>Topic: ${escapeHtml(topic)}<br>Reference: ${reference}</p><hr><p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`
  return send({ email: process.env.SUPPORT_INBOX || 'info@student-advisor.co.uk', subject, text, html })
}
export function sendPasswordResetEmail({ email, resetUrl }) {
  return send({ email, subject: 'Reset your Student Advisor password', text: `Use this link within 15 minutes to reset your password: ${resetUrl}\n\nIf you did not request this, ignore this email.`, html: `<p>Use this link within 15 minutes to reset your password.</p><p><a href="${escapeHtml(resetUrl)}">Reset password</a></p><p>If you did not request this, ignore this email.</p>` })
}
export function sendVerificationEmail({ email, verificationUrl }) {
  return send({ email, subject: 'Verify your Student Advisor email', text: `Verify your email within 30 minutes: ${verificationUrl}\n\nOnly continue if you created or recovered this account. Otherwise ignore this message.`, html: `<p>Only continue if you created or recovered this Student Advisor account.</p><p><a href="${escapeHtml(verificationUrl)}">Verify your email</a> within 30 minutes.</p><p>Otherwise ignore this message.</p>` })
}
export function sendSecurityNotification({ email, event }) {
  const message = `Your Student Advisor account security changed: ${event}. If this was not you, reset your password and contact support immediately.`
  return send({ email, subject: 'Student Advisor account security notification', text: message, html: `<p>${escapeHtml(message)}</p>` })
}
