// Reads a Proving Ground challenge written as Markdown with front matter, for
// `yak lab challenge publish --from file.md` (docs/lab/proving-ground.md; drafts in
// docs/lab/challenges/):
//
//   ---
//   title: Fix the flake
//   starter: https://github.com/…        (optional)
//   window: 7d                           (optional: how long it's open; the API's default otherwise)
//   opens: 2026-11-02T09:00:00Z          (optional: when it opens; now otherwise)
//   sponsor: Acme                        (optional, with sponsor_url)
//   rubric:
//     - correct: The failing test passes every run, and no other test breaks.
//     - explained: The cause is named in a paragraph a newcomer follows.
//   ---
//   The brief, in Markdown.
//
// Only this small shape is read, not YAML in general. The API checks lengths and links.

export interface ChallengeFile {
  title: string;
  brief: string;
  rubric: { name: string; description: string }[];
  starter: string | null;
  sponsor: { name: string; url: string | null } | null;
  opensAt: string | null;
  /** Milliseconds, from `window`. */
  windowMs: number | null;
}

const KEYS = ["title", "starter", "window", "opens", "sponsor", "sponsor_url", "rubric"] as const;
type Key = (typeof KEYS)[number];

/** Unit conversions; not tunables. */
const UNITS: Record<string, number> = { h: 3_600_000, d: 86_400_000 };

/** "7d" or "36h". */
export function parseWindow(value: string): number {
  const match = /^(\d+)\s*([hd])$/.exec(value.trim());
  if (!match || Number(match[1]) < 1) throw new Error(`window is a number of hours or days, e.g. 7d or 36h; got "${value}".`);
  return Number(match[1]) * UNITS[match[2]!]!;
}

const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, "$2");

/** Throws with what's wrong, so the author can fix the file. */
export function parseChallengeFile(markdown: string): ChallengeFile {
  const text = markdown.replace(/^\u{FEFF}/u, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) throw new Error("A challenge file starts with front matter between --- lines (title, rubric, …), then the brief.");
  const meta: Partial<Record<Key, string>> = {};
  const rubric: { name: string; description: string }[] = [];
  let inRubric = false;
  for (const line of match[1]!.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = /^\s+-\s*([^:]+):\s*(.+)$/.exec(line);
    if (item && inRubric) {
      rubric.push({ name: item[1]!.trim(), description: unquote(item[2]!) });
      continue;
    }
    const pair = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!pair) throw new Error(`Can't read "${line.trim()}" in the front matter.`);
    const key = pair[1] as Key;
    if (!(KEYS as readonly string[]).includes(key)) throw new Error(`Unknown front matter key "${key}". Keys: ${KEYS.join(", ")}.`);
    if (meta[key] !== undefined) throw new Error(`"${key}" appears twice.`);
    meta[key] = unquote(pair[2]!);
    inRubric = key === "rubric";
  }
  const brief = match[2]!.trim();
  if (!meta.title) throw new Error("The front matter needs a title.");
  if (rubric.length === 0) throw new Error("The front matter needs a rubric: lines like `  - correct: what a good answer does`.");
  if (!brief) throw new Error("Write the brief after the front matter.");
  if (meta.sponsor_url && !meta.sponsor) throw new Error("sponsor_url needs a sponsor.");
  return {
    title: meta.title,
    brief,
    rubric,
    starter: meta.starter || null,
    sponsor: meta.sponsor ? { name: meta.sponsor, url: meta.sponsor_url || null } : null,
    opensAt: meta.opens || null,
    windowMs: meta.window ? parseWindow(meta.window) : null,
  };
}
