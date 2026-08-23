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

module.exports = { transcribeAudio, generateDraftReport };
