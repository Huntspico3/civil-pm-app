const nodemailer = require('nodemailer');

let transporter = null;
let warnedMissingConfig = false;

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return transporter;
}

// Fire-and-forget: notification email should never block or fail the RFI creation request.
async function sendRfiAssignedEmail({ to, toName, projectName, question, askedByName }) {
  const t = getTransporter();
  if (!t) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn(
        'RFI email notifications are not configured (missing SMTP_HOST/SMTP_USER/SMTP_PASS). ' +
        'Skipping email — the RFI itself was still created normally.'
      );
    }
    return;
  }

  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
  const subject = `New RFI assigned to you: ${projectName}`;
  const text =
    `Hi ${toName},\n\n` +
    `${askedByName} has assigned you an RFI on "${projectName}":\n\n` +
    `"${question}"\n\n` +
    `Log in to the Civil PM app to answer it.\n`;

  try {
    await t.sendMail({ from, to, subject, text });
  } catch (err) {
    console.warn('Failed to send RFI assignment email:', err.message);
  }
}

// Fire-and-forget, same as the RFI notification above: a failed/unconfigured
// email should never block the weekly summary from being saved and shown in
// the app.
async function sendProjectSummaryEmail({ to, toName, projectName, summaryText }) {
  const t = getTransporter();
  if (!t) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn(
        'Email notifications are not configured (missing SMTP_HOST/SMTP_USER/SMTP_PASS). ' +
        'Skipping email — the weekly summary was still generated and saved normally.'
      );
    }
    return;
  }

  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
  const subject = `Weekly summary: ${projectName}`;
  const text =
    `Hi ${toName},\n\n` +
    `Here's this week's summary for "${projectName}":\n\n` +
    `${summaryText}\n\n` +
    `Log in to the Civil PM app for full details.\n`;

  try {
    await t.sendMail({ from, to, subject, text });
  } catch (err) {
    console.warn('Failed to send weekly project summary email:', err.message);
  }
}

// Fire-and-forget, same as the notifications above: a failed/unconfigured
// email should never block or fail the weekly update submission itself.
async function sendWeeklyUpdateSubmittedEmail({ to, toName, projectName, submittedByName, weekLabel, whatWasDone, issues, planNextWeek, percentComplete }) {
  const t = getTransporter();
  if (!t) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn(
        'Email notifications are not configured (missing SMTP_HOST/SMTP_USER/SMTP_PASS). ' +
        'Skipping email — the weekly update was still saved normally.'
      );
    }
    return;
  }

  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
  const subject = `Weekly update submitted: ${projectName}`;
  const text =
    `Hi ${toName},\n\n` +
    `${submittedByName} submitted the weekly update for "${projectName}" (week of ${weekLabel}):\n\n` +
    `What was done:\n${whatWasDone || '(none noted)'}\n\n` +
    `Issues / blockers:\n${issues || '(none noted)'}\n\n` +
    `Plan for next week:\n${planNextWeek || '(none noted)'}\n\n` +
    `% complete: ${percentComplete == null ? 'Not specified' : percentComplete + '%'}\n\n` +
    `Log in to the Civil PM app for full details.\n`;

  try {
    await t.sendMail({ from, to, subject, text });
  } catch (err) {
    console.warn('Failed to send weekly update submitted email:', err.message);
  }
}

// Fire-and-forget, same as the notifications above: a failed/unconfigured
// email should never block the reminder check from marking the project as
// handled for the week.
async function sendWeeklyUpdateReminderEmail({ to, toName, projectName }) {
  const t = getTransporter();
  if (!t) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn(
        'Email notifications are not configured (missing SMTP_HOST/SMTP_USER/SMTP_PASS). ' +
        'Skipping email — the weekly update reminder check still ran normally.'
      );
    }
    return;
  }

  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
  const subject = `Reminder: weekly update due for ${projectName}`;
  const text =
    `Hi ${toName},\n\n` +
    `No weekly update has been submitted yet for "${projectName}" this week. Please add it before the weekly call.\n\n` +
    `Log in to the Civil PM app to submit it.\n`;

  try {
    await t.sendMail({ from, to, subject, text });
  } catch (err) {
    console.warn('Failed to send weekly update reminder email:', err.message);
  }
}

module.exports = { sendRfiAssignedEmail, sendProjectSummaryEmail, sendWeeklyUpdateSubmittedEmail, sendWeeklyUpdateReminderEmail };
