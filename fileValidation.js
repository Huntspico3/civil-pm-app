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

// .xlsx files are actually zip archives, so their real signature is the zip
// local-file-header magic number. Same "don't trust the claimed type" logic
// as the image/audio checks above, applied to the task-import upload — the
// file here comes from multer's memory storage, so this checks the buffer
// directly rather than reading it back off disk.
const ZIP_SIGNATURE = [0x50, 0x4B, 0x03, 0x04];
function isValidXlsxBuffer(buffer) {
  if (!buffer || buffer.length < ZIP_SIGNATURE.length) return false;
  return ZIP_SIGNATURE.every((byte, i) => buffer[i] === byte);
}

// Document Register uploads: PDFs, Office documents, and images, checked
// against their real signature the same way as everything else above. Office
// Open XML formats (.docx/.xlsx/.pptx) are zip archives, same as .xlsx
// above; legacy binary Office formats (.doc/.xls/.ppt) share one common OLE
// compound-file signature. A couple of common CAD formats (.dwg, .dxf) have
// no single reliable signature across every authoring tool/version, so those
// are allowed by extension only — everything else here is positively
// verified against its actual bytes, not just its claimed name.
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46]; // %PDF
const OLE_SIGNATURE = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]; // legacy .doc/.xls/.ppt

function isValidPdfFile(filePath) {
  return matchesSignature(readFileHeader(filePath, 8), { bytes: PDF_SIGNATURE });
}
function isValidOleFile(filePath) {
  return matchesSignature(readFileHeader(filePath, 8), { bytes: OLE_SIGNATURE });
}
function isValidZipFile(filePath) {
  return matchesSignature(readFileHeader(filePath, 4), { bytes: ZIP_SIGNATURE });
}

const DOCUMENT_VALIDATORS = {
  '.pdf': isValidPdfFile,
  '.doc': isValidOleFile, '.xls': isValidOleFile, '.ppt': isValidOleFile,
  '.docx': isValidZipFile, '.xlsx': isValidZipFile, '.pptx': isValidZipFile, '.zip': isValidZipFile,
  '.jpg': isValidImageFile, '.jpeg': isValidImageFile, '.png': isValidImageFile, '.gif': isValidImageFile, '.webp': isValidImageFile,
  '.dwg': null, '.dxf': null, '.txt': null, '.csv': null
};

function isAllowedDocumentExtension(ext) {
  return Object.prototype.hasOwnProperty.call(DOCUMENT_VALIDATORS, String(ext).toLowerCase());
}

// True if the file's actual content matches what its (already-allowlisted)
// extension claims, or true unconditionally for the few extensions above
// with no reliable signature to check.
function isValidDocumentFile(filePath, ext) {
  const validator = DOCUMENT_VALIDATORS[String(ext).toLowerCase()];
  return validator ? validator(filePath) : true;
}

module.exports = {
  isValidImageFile, isValidAudioFile, detectImageExt, detectAudioExt, isValidXlsxBuffer,
  isAllowedDocumentExtension, isValidDocumentFile
};
