const fs = require('fs');

// Multer's fileFilter only checks the Content-Type the uploading browser
// *claims* — an attacker fully controls that header, so it's not real
// verification. These check the file's actual first bytes ("magic numbers")
// against known formats, covering what this app's own upload inputs
// (<input accept="image/*">, MediaRecorder, <input accept="audio/*">) can
// realistically produce. No external dependency needed for this.

const IMAGE_SIGNATURES = [
  { bytes: [0xFF, 0xD8, 0xFF], ext: '.jpg' },                              // JPEG
  { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], ext: '.png' }, // PNG
  { bytes: [0x47, 0x49, 0x46, 0x38], ext: '.gif' },                        // GIF87a / GIF89a
  { bytes: [0x52, 0x49, 0x46, 0x46], riffType: 'WEBP', ext: '.webp' }      // WEBP (RIFF....WEBP)
];

const AUDIO_SIGNATURES = [
  { bytes: [0x1A, 0x45, 0xDF, 0xA3], ext: '.webm' }, // WebM/Matroska — MediaRecorder's typical output
  { bytes: [0x4F, 0x67, 0x67, 0x53], ext: '.ogg' },  // OGG
  { bytes: [0x49, 0x44, 0x33], ext: '.mp3' },        // MP3 with an ID3v2 tag
  { bytes: [0xFF, 0xFB], ext: '.mp3' },              // MP3 frame sync, no tag
  { bytes: [0xFF, 0xF3], ext: '.mp3' },
  { bytes: [0xFF, 0xF2], ext: '.mp3' },
  { bytes: [0x52, 0x49, 0x46, 0x46], riffType: 'WAVE', ext: '.wav' } // WAV (RIFF....WAVE)
];

function matchesSignature(header, sig) {
  if (header.length < sig.bytes.length) return false;
  for (let i = 0; i < sig.bytes.length; i++) {
    if (header[i] !== sig.bytes[i]) return false;
  }
  if (sig.riffType) {
    if (header.length < 12) return false;
    return header.slice(8, 12).toString('ascii') === sig.riffType;
  }
  return true;
}

function readFileHeader(filePath, length = 16) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, 0);
    return buffer.slice(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function detectExt(filePath, signatures) {
  const header = readFileHeader(filePath);
  const match = signatures.find(sig => matchesSignature(header, sig));
  return match ? match.ext : null;
}

// Returns the correct extension for the file's *actual* content (e.g. '.png'),
// or null if it doesn't match any known image signature at all.
function detectImageExt(filePath) {
  return detectExt(filePath, IMAGE_SIGNATURES);
}

function detectAudioExt(filePath) {
  return detectExt(filePath, AUDIO_SIGNATURES);
}

function isValidImageFile(filePath) {
  return detectImageExt(filePath) !== null;
}

function isValidAudioFile(filePath) {
  return detectAudioExt(filePath) !== null;
}

module.exports = { isValidImageFile, isValidAudioFile, detectImageExt, detectAudioExt };
