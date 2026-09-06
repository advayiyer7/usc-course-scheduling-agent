import { it, expect } from "vitest";
import { normalize } from "../packages/source-usc/src/schema.js";
import { clearanceRegistry } from "../packages/source-usc/src/clearance-registry.js";
import {
  guidanceForCourse,
  clearanceForSection,
} from "../packages/domain/src/clearance.js";
import { isOfficialUscUrl } from "../packages/contracts/src/review.js";
import { response, course } from "./fixtures.js";
const now = Date.parse("2026-09-07T00:00:00Z");
function c(code = "CSCI426", program = "ENGV/CSCI") {
  const item = normalize(20263, [response([course(code)])])[0]!;
  item.programs = [program];
  return item;
}
it("preserves the source's SOWK campus/online groupings without guessing unknown departments", () => {
  const item = c("SOWK506", "SWDP/SWKC");
  item.programs.push("SWDP/SWKO", "DRNS/EALC");
  const g = guidanceForCourse(item, 20263, now);
  expect(g.routes.some((r) => r.id === "social-work")).toBe(true);
  expect(
    g.routes
      .filter((r) => r.kind === "catalog_directory")
      .map((r) => r.url.split("/").at(-1)),
  ).toEqual(["SWKC", "SWKO"]);
  expect(
    guidanceForCourse(c("KSI399", "DRNS/EASC"), 20263, now).coverage_status,
  ).toBe("unresolved");
});
it("routes a cross-listed request by scheduled identity, not another department's alias", () => {
  const item = c("CTPR490", "CNMA/CTPR");
  item.aliases.push("ENGL490");
  item.programs.push("DRNS/ENGL");
  const g = guidanceForCourse(item, 20263, now);
  expect(g.routes.some((r) => r.id === "cinema")).toBe(true);
  expect(g.routes.some((r) => r.id.startsWith("dornsife"))).toBe(false);
  expect(
    g.routes.filter((r) => r.kind === "catalog_directory").map((r) => r.url),
  ).toEqual([
    "https://classes.usc.edu/term/20263/catalogue/school/CNMA/program/CTPR",
  ]);
});
it("does not turn a department routing entry into a clearance requirement or an approval", () => {
  const item = c(),
    section = item.sections[0]!;
  for (const [flag, requirement] of [
    [true, "required"],
    [false, "not_indicated"],
    [null, "unknown"],
  ] as const) {
    section.d_clearance = flag;
    const result = clearanceForSection(item, section, 20263, now);
    expect(result.requirement).toBe(requirement);
    expect(result.approval_status).toBe("unknown");
    expect(result.guidance.routes.some((r) => r.id === "csci")).toBe(true);
  }
});
it("does not carry Fall-only instructions into another term", () => {
  const g = guidanceForCourse(c(), 20271, now);
  expect(g.coverage_status).toBe("catalog_only");
  expect(
    g.routes.every(
      (r) => r.kind === "catalog_directory" && r.url.includes("20271"),
    ),
  ).toBe(true);
});
it("distinguishes course levels and labels audience-specific routes", () => {
  expect(
    guidanceForCourse(c("PPD240", "PPDP/PPD"), 20263, now).routes.some(
      (r) => r.id === "price-ug",
    ),
  ).toBe(true);
  const grad = guidanceForCourse(c("PPD540", "PPDP/PPD"), 20263, now);
  expect(grad.routes.some((r) => r.id === "price-ug")).toBe(false);
  expect(grad.routes.some((r) => r.id === "price-grad")).toBe(true);
  const ee = guidanceForCourse(c("EE109", "ENGV/EE"), 20263, now);
  expect(
    ee.routes.find((r) => r.id === "ee-preengineering")?.audience,
  ).toContain("Pre-engineering");
});
it("provides a source-backed program directory when no specific route has been researched", () => {
  const g = guidanceForCourse(c("LAW500", "LAW/LAW"), 20263, now);
  expect(g.coverage_status).toBe("catalog_only");
  expect(g.routes[0]?.source_url).toContain(
    "AEA-Navigation-Guides-D-Clearance.pdf",
  );
  expect(g.warnings.some((w) => w.includes("No researched"))).toBe(true);
});
it("rejects deceptive URLs and malformed program associations without emitting unsafe links", () => {
  for (const url of [
    "https://usc.edu.evil.test/a",
    "https://evilusc.edu/a",
    "http://usc.edu/a",
    "https://u:p@usc.edu/a",
    "https://usc.edu:444/a",
    "https://usc.edu/a?token=secret",
    "javascript:alert(1)",
  ])
    expect(isOfficialUscUrl(url)).toBe(false);
  const item = c("LAW500", "LAW/../../evil");
  expect(guidanceForCourse(item, 20263, now).coverage_status).toBe(
    "unresolved",
  );
  expect(guidanceForCourse(item, 20263, now).routes).toEqual([]);
  expect(() => guidanceForCourse(c(), 20269, now)).toThrow();
});
it("marks guidance due for review independently of course snapshot age", () => {
  const g = guidanceForCourse(c(), 20263, Date.parse("2026-11-01T00:00:00Z"));
  expect(g.routes.every((r) => r.stale)).toBe(true);
  expect(g.warnings.some((w) => w.includes("re-verification"))).toBe(true);
});
it("keeps registry identifiers unique and all emitted links on official HTTPS instruction pages", () => {
  expect(new Set(clearanceRegistry.map((r) => r.id)).size).toBe(
    clearanceRegistry.length,
  );
  expect(clearanceRegistry.every((r) => isOfficialUscUrl(r.url))).toBe(true);
});
