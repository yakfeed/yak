// The skill version's archive: a deterministic, uncompressed ustar
// file, so the same files always make the same bytes. Entries sorted by path, under one top
// folder, every timestamp, owner and group zero, mode 0644, no compression (so no gzip timestamp).
// Small enough to read and write here: no dependency. The archive served on the web is gzipped
// (`yakfeed.tar.gz`), which readArchive doesn't undo: gunzip first. Only tests read one today.

const BLOCK = 512;
const NAME_MAX = 100;

export interface ArchiveEntry {
  /** Path inside the archive, with `/` separators. */
  path: string;
  bytes: Uint8Array;
}

function octal(value: number, width: number): string {
  // width includes the terminating NUL.
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function header(path: string, size: number): Buffer {
  const h = Buffer.alloc(BLOCK, 0);
  const name = Buffer.from(path, "utf8");
  if (name.length > NAME_MAX) throw new Error(`Archive path too long (at most ${NAME_MAX} bytes): ${path}`);
  name.copy(h, 0);
  h.write(octal(0o644, 8), 100, "ascii");
  h.write(octal(0, 8), 108, "ascii");
  h.write(octal(0, 8), 116, "ascii");
  h.write(octal(size, 12), 124, "ascii");
  h.write(octal(0, 12), 136, "ascii");
  h.write("        ", 148, "ascii");
  h.write("0", 156, "ascii");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  let sum = 0;
  for (const byte of h) sum += byte;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return h;
}

/** The archive's bytes: `root/` + each entry's path, sorted, then two empty blocks. */
export function buildArchive(root: string, entries: readonly ArchiveEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const parts: Buffer[] = [];
  const seen = new Set<string>();
  for (const e of sorted) {
    if (seen.has(e.path)) throw new Error(`Twice in the archive: ${e.path}`);
    if (e.path.startsWith("/") || e.path.split("/").includes("..")) throw new Error(`Not a relative path: ${e.path}`);
    seen.add(e.path);
    const bytes = Buffer.from(e.bytes);
    parts.push(header(`${root}/${e.path}`, bytes.length), bytes, Buffer.alloc((BLOCK - (bytes.length % BLOCK)) % BLOCK, 0));
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0));
  return Buffer.concat(parts);
}

/** The entries of an archive buildArchive wrote, with the top folder taken off. */
export function readArchive(archive: Uint8Array, root: string): ArchiveEntry[] {
  const buf = Buffer.from(archive);
  const out: ArchiveEntry[] = [];
  let at = 0;
  while (at + BLOCK <= buf.length) {
    const h = buf.subarray(at, at + BLOCK);
    if (h.every((b) => b === 0)) return out;
    const name = h.subarray(0, NAME_MAX).toString("utf8").replace(/\0.*$/s, "");
    if (h.subarray(257, 262).toString("ascii") !== "ustar" || h.toString("ascii", 156, 157) !== "0") throw new Error(`Not a plain ustar file entry: ${name}`);
    const size = Number.parseInt(h.toString("ascii", 124, 135), 8);
    if (!name.startsWith(`${root}/`)) throw new Error(`Outside ${root}/: ${name}`);
    const path = name.slice(root.length + 1);
    if (path.split("/").includes("..")) throw new Error(`Not a relative path: ${name}`);
    out.push({ path, bytes: Buffer.from(buf.subarray(at + BLOCK, at + BLOCK + size)) });
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  throw new Error("The archive ends without its two empty blocks.");
}
