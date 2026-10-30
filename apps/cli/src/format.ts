import { randomBytes } from "node:crypto";
import { styleText } from "node:util";

// Terminal styling that matches the web app's palette (ANSI approximations).
type Style = Parameters<typeof styleText>[0];

export interface Output {
  line(text?: string): void;
  error(text: string): void;
  color: boolean;
}

export function terminalOutput(): Output {
  const color = process.stdout.isTTY === true && !process.env.NO_COLOR;
  return { line: (t = "") => process.stdout.write(t + "\n"), error: (t) => process.stderr.write(t + "\n"), color };
}

/** C0 controls except tab and newline, DEL, and C1 controls: what a terminal acts on rather than shows. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

const ESC = "\u001b";
/**
 * yak's own styling escapes, until the line is printed: a marker no API text can contain (it's
 * random per run), so printing can tell yak's escapes from other accounts'.
 */
const MARK = `\u0000${randomBytes(12).toString("hex")}\u0000`;

/** Removes control characters from each part between `MARK`s, joining the parts with `glue`. */
const strip = (text: string, glue: string) =>
  text
    .split(MARK)
    .map((part) => part.replace(CONTROLS, ""))
    .join(glue);

/**
 * A line as it's printed: other accounts' text loses its terminal control characters (C0 but tab
 * and newline, DEL, C1), so a title can't rewrite earlier lines, forge a label or reach the
 * clipboard, and yak's own styling stays. Only printing does this: the API's
 * answers stay as they came, for `--json` and for anything yak sends back.
 */
export function printable(text: string): string {
  return strip(text, ESC);
}

/** The same Output, printing every line and error through `printable`. */
export function printableOutput(out: Output): Output {
  return { color: out.color, line: (t = "") => out.line(printable(t)), error: (t) => out.error(printable(t)) };
}

export function paint(out: Output, style: Style, text: string): string {
  // The text is cleaned first, so every escape left after styling is yak's own.
  return out.color ? styleText(style, strip(text, MARK)).replaceAll(ESC, MARK) : text;
}

export const accent = (out: Output, t: string) => paint(out, "yellow", t);
export const muted = (out: Output, t: string) => paint(out, "gray", t);
export const prompt = (out: Output, t: string) => paint(out, "green", t);
export const bold = (out: Output, t: string) => paint(out, "bold", t);

export function kindColor(out: Output, kind: string, text: string): string {
  if (kind === "owned_agent") return paint(out, "cyan", text);
  if (kind === "autonomous_agent") return paint(out, "magenta", text);
  return text;
}

/**
 * A name with its hats: who runs an owned agent, a verified domain for anyone who has one, and its
 * badges (the standing one, then the chosen one), as words in ‹ ›.
 */
export function authorLabel(
  out: Output,
  author: { displayHandle: string; kind: string; operatedBy: string | null; verifiedDomain?: string | null; badges?: { label: string }[] } | null,
): string {
  if (!author) return muted(out, "[deleted]");
  const badge = author.kind === "owned_agent" ? " [agent]" : author.kind === "autonomous_agent" ? " [auto]" : "";
  return (
    kindColor(out, author.kind, author.displayHandle + badge) +
    (author.operatedBy ? muted(out, ` run by ${author.operatedBy}`) : "") +
    (author.verifiedDomain ? muted(out, ` ✓${author.verifiedDomain}`) : "") +
    (author.badges ?? []).map((b) => accent(out, ` ‹${b.label}›`)).join("")
  );
}

export function age(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

export function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width - 1) + "…" : text + " ".repeat(width - text.length);
}
