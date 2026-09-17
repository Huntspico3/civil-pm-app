const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

// Transcribes an audio file using OpenAI's Whisper API.
// Requires OPENAI_API_KEY. This is a separate provider from the report-writing
// step below because Claude's Messages API does not accept audio input.
async function transcribeAudio(filePath, mimeType) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Missing OPENAI_API_KEY environment variable. Get an API key from https://platform.openai.com/api-keys ' +
      'and set it as an environment variable named OPENAI_API_KEY before restarting the server.'
    );
  }

  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer], { type: mimeType || 'application/octet-stream' });
  const form = new FormData();
  form.append('file', blob, path.basename(filePath));
  form.append('model', 'whisper-1');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Transcription request failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.text;
}

// Turns a raw transcript into a structured draft report using Claude.
// Requires ANTHROPIC_API_KEY. Explicitly instructed not to add judgment,
// safety assessments, or recommendations — only to organize what was said.
async function generateDraftReport({ transcript, projectName, submitterName, dateStr }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'Missing ANTHROPIC_API_KEY environment variable. Get an API key from https://console.anthropic.com/settings/keys ' +
      'and set it as an environment variable named ANTHROPIC_API_KEY before restarting the server.'
    );
  }

  const client = new Anthropic();

  const systemPrompt = `You turn a raw spoken-word transcript from a civil engineering field visit into a clean, organized written report.

Rules:
- Only reorganize, clarify, and lightly clean up grammar of what was actually said. Do not add judgment calls, safety assessments, risk ratings, severity levels, or recommendations of your own.
- Do not invent details that were not mentioned in the transcript.
- If the transcript does not mention something for a section, write "Not specified" for that section rather than guessing.
- Output plain text using exactly these five section headers, each on its own line, in this order:
Date:
Project:
Location/Area:
Observations:
Issues Noted:
- "Date" and "Project" are given to you directly below — copy them as-is, don't reinterpret them.
- "Location/Area", "Observations", and "Issues Noted" should be drawn from the transcript content.`;

  const userPrompt = `Date: ${dateStr}
Project: ${projectName}
Submitted by: ${submitterName}

Raw transcript of the field voice note:
"""
${transcript}
"""

Write the structured report now, following the rules exactly.`;

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock ? textBlock.text.trim() : '';
}

// Caps how many items from a list get spelled out by name in the prompt, so
// a large project (dozens of tasks) doesn't blow up the prompt size — the
// model is still told the true total count either way.
function summarizeList(items, formatItem, limit = 10) {
  if (items.length === 0) return '(none)';
  const shown = items.slice(0, limit).map(formatItem).join('\n');
  const remainder = items.length - limit;
  return remainder > 0 ? `${shown}\n...and ${remainder} more` : shown;
}

// Turns this week's raw project stats into a short, readable briefing using
// Claude. Requires ANTHROPIC_API_KEY. `stats` fields are plain data already
// gathered by the caller (server.js) — this function only writes the prose.
async function generateProjectSummary({ projectName, stats }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'Missing ANTHROPIC_API_KEY environment variable. Get an API key from https://console.anthropic.com/settings/keys ' +
      'and set it as an environment variable named ANTHROPIC_API_KEY before restarting the server.'
    );
  }

  const client = new Anthropic();

  const systemPrompt = `You write short, plain-English weekly briefings for a civil engineering project management tool. The reader is a busy project manager or admin who wants the gist in under a minute.

Rules:
- Write 2-4 short paragraphs of plain prose. Do not use bullet points, headers, or a raw restatement of the numbers you're given — synthesize them into readable sentences, the way a person would summarize a status update out loud.
- Only use the facts given below. Do not invent task names, dates, or details that weren't provided.
- Call out overdue tasks and overdue RFIs clearly if there are any — that's the most actionable part of a status briefing.
- Mention the overall progress percentage and give a brief sense of trajectory (e.g. steady, ahead, behind, stalled) based on the numbers, without fabricating a cause.
- Keep the tone factual and neutral, not alarmist or falsely upbeat.`;

  const userPrompt = `Project: ${projectName}
Overall progress: ${stats.progress}% (${stats.totalTasks} task${stats.totalTasks === 1 ? '' : 's'} total)

Tasks completed this week (${stats.completedThisWeek.length}):
${summarizeList(stats.completedThisWeek, t => `- ${t.title}`)}

Tasks still open (${stats.openTasks.length} total):
${summarizeList(stats.openTasks, t => `- ${t.title} (${t.status}${t.assignee ? ', ' + t.assignee.name : ', unassigned'})`)}

Overdue tasks (${stats.overdueTasks.length}):
${summarizeList(stats.overdueTasks, t => `- ${t.title}, was due ${t.dueDate}`)}

Open RFIs (${stats.openRfis.length}), of which overdue (${stats.overdueRfis.length}):
${summarizeList(stats.overdueRfis, r => `- "${r.question}", due ${r.dueDate}`)}

Write this week's briefing now, following the rules exactly.`;

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 700,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock ? textBlock.text.trim() : '';
}

module.exports = { transcribeAudio, generateDraftReport, generateProjectSummary };
