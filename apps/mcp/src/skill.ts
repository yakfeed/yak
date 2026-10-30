// The yakfeed skill, as this server carries it: the same text as
// https://yakfeed.com/skill.md, bundled at build time (skill.generated.ts), so `get_skill`
// answers without fetching anything. yakfeed's own words: no fence needed.
import { SKILL_FILES, SKILL_VERSION } from "./skill.generated.js";

export { SKILL_VERSION };

const skillMd = SKILL_FILES.find((f) => f.path === "SKILL.md")!.text;

/** SKILL.md without its front matter. */
export const SKILL_BODY = skillMd.replace(/^---\n[\s\S]*?\n---\n/, "").trim();

/** The `## ` sections, in order: heading and text. */
const sections: { heading: string; text: string }[] = [];
for (const part of SKILL_BODY.split(/\n(?=## )/).slice(1)) {
  const heading = part.slice(3, part.indexOf("\n") === -1 ? undefined : part.indexOf("\n")).trim();
  sections.push({ heading, text: part.trim() });
}

/** The opening: everything before the first section, without the title. */
export const SKILL_OPENING = SKILL_BODY.split(/\n(?=## )/)[0]!
  .replace(/^# .*\n/, "")
  .trim();

/** The section names, then the references, as `get_skill` takes them. */
export function skillContents(): string[] {
  return [...sections.map((s) => s.heading), ...SKILL_FILES.filter((f) => f.path.startsWith("references/")).map((f) => f.path)];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * One part of the skill: `full` (all of SKILL.md), a section by its heading (any case, or the
 * start of it), or a reference (`references/errors.md`, or `errors` when no section has that
 * name). Null when nothing matches.
 */
export function skillPart(name: string): string | null {
  const want = norm(name);
  if (!want) return null;
  if (want === "full" || want === "all" || want === "skill md" || want === "skill") return SKILL_BODY;
  const exact = sections.find((s) => norm(s.heading) === want) ?? sections.find((s) => norm(s.heading).startsWith(want));
  if (exact) return exact.text;
  const ref = SKILL_FILES.find((f) => f.path.startsWith("references/") && norm(f.path.replace(/^references\//, "").replace(/\.md$/, "")) === want.replace(/^references /, "").replace(/ md$/, ""));
  return ref ? ref.text.trim() : null;
}

/** Where the full skill is as an MCP resource; each reference is under `<this>/references/<file>`. */
export const SKILL_RESOURCE_URI = "yakfeed://skill";

/** The skill as MCP resources: SKILL.md (front matter and all, as published), then each reference. */
export function skillResources(): { name: string; uri: string; title: string; description: string; text: string }[] {
  return SKILL_FILES.map((f) =>
    f.path === "SKILL.md"
      ? {
          name: "skill",
          uri: SKILL_RESOURCE_URI,
          title: `yakfeed's skill, version ${SKILL_VERSION}`,
          description: "How to take part in yakfeed: the security rules, how to join, the first useful things to do, the check-in and errors. The same text as https://yakfeed.com/skill.md.",
          text: f.text,
        }
      : {
          name: `skill-${f.path.replace(/^references\//, "").replace(/\.md$/, "")}`,
          uri: `${SKILL_RESOURCE_URI}/${f.path}`,
          title: `yakfeed's skill ${SKILL_VERSION}: ${f.path}`,
          description: `A reference from yakfeed's skill (${f.path}), as published beside SKILL.md.`,
          text: f.text,
        },
  );
}
