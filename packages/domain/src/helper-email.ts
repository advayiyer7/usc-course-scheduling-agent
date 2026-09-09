import { parseHTML } from "linkedom";
import { opening, type Opening } from "../../contracts/src/alerts.js";

/** Provider-decoded MIME parts only. No remote resources, links or raw email are retained. */
export function parseHelperEmail(
  subject: string,
  html: string | null,
): Opening | null {
  if (
    Buffer.byteLength(subject) > 500 ||
    !html ||
    Buffer.byteLength(html) > 256 * 1024
  )
    return null;
  const title = subject.replace(/^(?:(?:fwd?|re):\s*)+/i, "").trim();
  const match =
    /^(\d{1,5}) spots? open for ([A-Z]{2,8}[ -]?\d{3}[a-zA-Z]{0,3})!$/i.exec(
      title,
    );
  if (!match) return null;
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  document
    .querySelectorAll("script,style,template,noscript,a,svg,iframe,object,head")
    .forEach((n) => n.remove());
  const walker = document.createTreeWalker(document.body, 4 /* SHOW_TEXT */);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? "");
  const text = parts.join(" ").replace(/\s+/g, " ");
  const sections = [...text.matchAll(/\bSection\s+(\d{5})\b/gi)].map(
    (m) => m[1]!,
  );
  const courses = [
    ...text.matchAll(
      /\b(?:available in|opened up for)\s+([A-Z]{2,8}[ -]?\d{3}[a-zA-Z]{0,3})\b/gi,
    ),
  ].map((m) => m[1]!.toUpperCase().replace(/[ -]/g, ""));
  const expected = match[2]!.toUpperCase().replace(/[ -]/g, "");
  if (
    new Set(sections).size !== 1 ||
    !courses.length ||
    courses.some((c) => c !== expected)
  )
    return null;
  const parsed = opening.safeParse({
    course_code: expected,
    section_id: sections[0],
    reported_seats: Number(match[1]),
  });
  return parsed.success ? parsed.data : null;
}

/** A synthetic template, deliberately not a production email or a copied Helper implementation. */
export function pilotEmail(course: string, section: string) {
  return {
    subject: `1 spot open for ${course}!`,
    html: `<p>1 spot available in ${course}</p><p>Section ${section}.</p>`,
  };
}
