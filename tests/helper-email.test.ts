import { describe, it, expect } from "vitest";
import {
  parseHelperEmail,
  pilotEmail,
} from "../packages/domain/src/helper-email.js";
describe("bounded Helper MIME-part parser", () => {
  const subject = "1 spot open for CSCI 104!";
  const html =
    '<p>1 spot available in CSCI-104</p><p>You requested spots opened up for CSCI-104, Synthetic title - Section 30242.</p><a href="https://usc.jonlu.ca/watch?key=SECRET&section=99999">Continue receiving notifications</a>';
  it("extracts only public identity and seat count, never account keys or the internal watch ID", () => {
    expect(parseHelperEmail(subject, html)).toEqual({
      course_code: "CSCI104",
      section_id: "30242",
      reported_seats: 1,
    });
    expect(JSON.stringify(parseHelperEmail(subject, html))).not.toContain(
      "SECRET",
    );
  });
  it("supports an automatic-forward subject prefix and repeated identical preview text", () => {
    expect(
      parseHelperEmail("Fwd: " + subject, html + "<div>Section 30242</div>")
        ?.section_id,
    ).toBe("30242");
  });
  it("ignores executable content, links and embedded resources without fetching", () => {
    expect(
      parseHelperEmail(
        subject,
        html +
          '<script>Section 99999; fetch("https://evil.example")</script><style>Section 88888</style><a href="https://evil.example">Section 77777</a><img src="https://evil.example/pixel">',
      )?.section_id,
    ).toBe("30242");
  });
  it("rejects missing HTML/section, conflicting identities, oversized content and unexpected subjects", () => {
    for (const body of [
      null,
      "Only a subject",
      html + " Section 11111",
      html.replaceAll("CSCI-104", "EE-109"),
      "x".repeat(256 * 1024 + 1),
    ])
      expect(parseHelperEmail(subject, body)).toBeNull();
    for (const title of [
      "Verify your forwarding address",
      "Registration confirmed",
      "0 spots open for CSCI 104!",
      "99999 spots open for CSCI 104!",
    ])
      expect(parseHelperEmail(title, html)).toBeNull();
  });
  it("runs synthetic tests through the same parser", () => {
    const m = pilotEmail("TEST100", "10001");
    expect(parseHelperEmail(m.subject, m.html)?.section_id).toBe("10001");
  });
});
