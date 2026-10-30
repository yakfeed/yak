// Reads a postmortem written as Markdown, for `yak lab postmortem write --from file.md`
// (docs/lab/postmortems.md; an example in docs/lab/postmortem-example.md):
//
//   # Title, one line
//   Severity: minor | moderate | major
//   Tags: missed-signal, tool-output
//
//   ## Goal
//   ## What happened
//   ## Cause
//   ## What would have caught it
//   ## What changed        (optional)
//   ## Timeline            (optional; for incident.io only, skipped here)
//   ## Follow-ups          (optional; for incident.io only, skipped here)
//
// Severity and tags lines are optional (flags can give them). HTML comments are ignored. Inside
// a code fence (``` or ~~~) nothing is structure: a quoted `## step 1` or `<!-- -->` stays text
//. The API checks lengths, tags and severity; this only finds the parts.

export interface PostmortemFile {
  title: string | null;
  severity: string | null;
  tags: string[];
  goal: string | null;
  happened: string | null;
  cause: string | null;
  caughtBy: string | null;
  changed: string | null;
}

type Section = "goal" | "happened" | "cause" | "caughtBy" | "changed";

/** The section headings, lowercased, and the field each fills. */
const HEADINGS: Record<string, Section> = {
  goal: "goal",
  "what happened": "happened",
  cause: "cause",
  "what would have caught it": "caughtBy",
  "what changed": "changed",
};

export const SECTION_HEADINGS = ["Goal", "What happened", "Cause", "What would have caught it", "What changed"];

/** Sections the postmortem sync reads for incident.io (tools/postmortem-sync), which the Lab doesn't store. */
const INCIDENT_IO_ONLY = new Set(["timeline", "follow-ups", "follow ups"]);

/** Throws with what's wrong, naming the heading, so the author can fix the file. */
export function parsePostmortemFile(markdown: string): PostmortemFile {
  const result: PostmortemFile = { title: null, severity: null, tags: [], goal: null, happened: null, cause: null, caughtBy: null, changed: null };
  let section: Section | "skip" | null = null;
  const skipped = new Set<string>();
  const body: Partial<Record<Section, string[]>> = {};
  for (const { line, fenced } of markdownLines(markdown)) {
    if (fenced) {
      if (section === "skip") continue;
      if (section) body[section]!.push(line);
      else if (line.trim()) throw new Error(`Text before the first section: "${line.trim()}". Put it under a ## heading.`);
      continue;
    }
    const h2 = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h2) {
      const name = h2[1]!.replace(/[:.]$/, "").toLowerCase();
      if (INCIDENT_IO_ONLY.has(name)) {
        if (skipped.has(name)) throw new Error(`"## ${h2[1]}" appears twice.`);
        skipped.add(name);
        section = "skip";
        continue;
      }
      const field = HEADINGS[name];
      if (!field) throw new Error(`Unknown section "## ${h2[1]}". Sections: ${SECTION_HEADINGS.map((h) => `## ${h}`).join(", ")}.`);
      if (body[field]) throw new Error(`"## ${h2[1]}" appears twice.`);
      section = field;
      body[field] = [];
      continue;
    }
    if (section === "skip") continue;
    if (section) {
      body[section]!.push(line);
      continue;
    }
    const h1 = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    if (h1) {
      if (result.title !== null) throw new Error("Only one title (# …) before the sections.");
      result.title = h1[1]!;
      continue;
    }
    const meta = /^(severity|tags):\s*(.*)$/i.exec(line.trim());
    if (meta) {
      if (meta[1]!.toLowerCase() === "severity") result.severity = meta[2]!.trim().toLowerCase() || null;
      else result.tags = meta[2]!.split(",").map((t) => t.trim()).filter(Boolean);
      continue;
    }
    if (line.trim()) throw new Error(`Text before the first section: "${line.trim()}". Put it under a ## heading.`);
  }
  for (const [field, text] of Object.entries(body) as [Section, string[]][]) {
    const value = text.join("\n").trim();
    result[field] = value || null;
  }
  return result;
}

/**
 * The file's lines, each saying whether it's inside a code fence (its fence lines included).
 * HTML comments outside fences are removed; a line wholly inside a comment is dropped.
 */
function markdownLines(markdown: string): { line: string; fenced: boolean }[] {
  const out: { line: string; fenced: boolean }[] = [];
  let fence: { char: string; length: number } | null = null;
  let inComment = false;
  for (const raw of markdown.split(/\r?\n/)) {
    if (fence) {
      out.push({ line: raw, fenced: true });
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(raw);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) fence = null;
      continue;
    }
    const startedInComment = inComment;
    let line = "";
    let rest = raw;
    let removed = false;
    while (rest) {
      if (inComment) {
        const end = rest.indexOf("-->");
        if (end === -1) break;
        rest = rest.slice(end + 3);
        inComment = false;
      } else {
        const start = rest.indexOf("<!--");
        if (start === -1) {
          line += rest;
          break;
        }
        line += rest.slice(0, start);
        rest = rest.slice(start + 4);
        inComment = true;
        removed = true;
      }
    }
    if (startedInComment && inComment) continue;
    if (startedInComment && !line.trim()) continue;
    const open = removed ? null : /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (open) {
      fence = { char: open[1]![0]!, length: open[1]!.length };
      out.push({ line, fenced: true });
      continue;
    }
    out.push({ line, fenced: false });
  }
  return out;
}
