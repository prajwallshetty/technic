import zlib from "node:zlib";

/**
 * Minimal, dependency-free ZIP reader for bulk invoice uploads.
 *
 * Supports stored and deflated entries and nested archives (a ZIP inside the
 * ZIP, as in the original technic.zip). Refuses — with a specific reason —
 * encrypted entries, ZIP64 archives, corrupt data (CRC mismatch) and archives
 * that exceed the size/entry limits, rather than silently skipping them.
 */

export class ArchiveError extends Error {
  constructor(
    message: string,
    readonly code: "PASSWORD_PROTECTED" | "CORRUPTED" | "UNSUPPORTED" | "TOO_LARGE",
  ) {
    super(message);
    this.name = "ArchiveError";
  }
}

export interface ArchiveFile {
  /** Path inside the archive, nested archives joined with "!/": "technic/186.zip!/186.pdf". */
  path: string;
  name: string;
  data: Buffer;
}

export interface ArchiveSkipped {
  path: string;
  reason: string;
}

export interface ArchiveContents {
  files: ArchiveFile[];
  skipped: ArchiveSkipped[];
}

export interface ArchiveLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxEntries: 1000,
  maxEntryBytes: 25 * 1024 * 1024,
  maxTotalBytes: 500 * 1024 * 1024,
  maxDepth: 3,
};

export function isZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

export function readZip(buffer: Buffer, limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS): ArchiveContents {
  const out: ArchiveContents = { files: [], skipped: [] };
  const budget = { entries: 0, bytes: 0 };
  readInto(buffer, "", 0, limits, budget, out);
  return out;
}

function readInto(
  buffer: Buffer,
  prefix: string,
  depth: number,
  limits: ArchiveLimits,
  budget: { entries: number; bytes: number },
  out: ArchiveContents,
) {
  const eocd = findEocd(buffer);
  if (eocd === -1) throw new ArchiveError(`${prefix || "Archive"}: not a valid ZIP (end-of-central-directory record not found)`, "CORRUPTED");

  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ArchiveError(`${prefix || "Archive"}: ZIP64 archives are not supported`, "UNSUPPORTED");
  }
  if (cdOffset + cdSize > buffer.length) throw new ArchiveError(`${prefix || "Archive"}: central directory is truncated`, "CORRUPTED");

  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) throw new ArchiveError(`${prefix || "Archive"}: corrupt central directory`, "CORRUPTED");
    const flags = buffer.readUInt16LE(pos + 8);
    const method = buffer.readUInt16LE(pos + 10);
    const crc = buffer.readUInt32LE(pos + 16);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const size = buffer.readUInt32LE(pos + 24);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const rawName = buffer.subarray(pos + 46, pos + 46 + nameLen);
    const name = rawName.toString(flags & 0x800 ? "utf8" : "latin1");
    pos += 46 + nameLen + extraLen + commentLen;

    const path = prefix ? `${prefix}!/${name}` : name;
    if (name.endsWith("/")) continue; // directory
    const base = name.split("/").pop() ?? name;
    if (name.startsWith("__MACOSX/") || base.startsWith("._") || base === ".DS_Store" || base === "Thumbs.db") continue;

    if (++budget.entries > limits.maxEntries) throw new ArchiveError(`Archive has more than ${limits.maxEntries} files`, "TOO_LARGE");
    if (flags & 0x1) {
      out.skipped.push({ path, reason: "Entry is password-protected (encrypted)" });
      continue;
    }
    if (size > limits.maxEntryBytes) {
      out.skipped.push({ path, reason: `Entry is ${(size / 1048576).toFixed(1)} MB, above the ${(limits.maxEntryBytes / 1048576).toFixed(0)} MB per-file limit` });
      continue;
    }
    if (budget.bytes + size > limits.maxTotalBytes) throw new ArchiveError("Archive expands beyond the total size limit", "TOO_LARGE");

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      out.skipped.push({ path, reason: "Local file header is corrupt" });
      continue;
    }
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    let data: Buffer;
    try {
      if (method === 0) data = Buffer.from(compressed);
      else if (method === 8) data = zlib.inflateRawSync(compressed, { maxOutputLength: limits.maxEntryBytes + 1 });
      else {
        out.skipped.push({ path, reason: `Unsupported compression method ${method}` });
        continue;
      }
    } catch (error) {
      out.skipped.push({ path, reason: `Could not decompress: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    if (data.length !== size || zlib.crc32(data) !== crc) {
      out.skipped.push({ path, reason: "Entry is corrupt (size or CRC mismatch)" });
      continue;
    }
    budget.bytes += size;

    if (isZip(data)) {
      if (depth + 1 > limits.maxDepth) {
        out.skipped.push({ path, reason: "Nested archive is too deep" });
        continue;
      }
      try {
        readInto(data, path, depth + 1, limits, budget, out);
      } catch (error) {
        if (error instanceof ArchiveError && error.code === "TOO_LARGE") throw error;
        out.skipped.push({ path, reason: error instanceof Error ? error.message : String(error) });
      }
      continue;
    }
    out.files.push({ path, name: base, data });
  }
}

function findEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/** Content sniffing — file extensions in uploads are not trusted. */
export function detectMimeType(data: Buffer, name: string): string | null {
  const head = data.subarray(0, 8);
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (head[0] === 0x89 && head.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if ((head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a) || (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0x00)) return "image/tiff";
  if (isZip(data)) {
    // Office documents are ZIPs too; identify them by extension so they are
    // reported as unsupported rather than unpacked.
    if (/\.(xlsx|docx|pptx|ods|odt)$/i.test(name)) return "application/vnd.office";
    return "application/zip";
  }
  if (/\.(csv|xls)$/i.test(name)) return "text/spreadsheet";
  return null;
}
