import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { it, expect, vi, afterEach } from "vitest";
import { ScheduleReview } from "../apps/extension/src/ScheduleReview.js";
import {
  observeValidation,
  type ReviewState,
} from "../apps/extension/src/validation-request.js";
import { inputs } from "../packages/contracts/src/index.js";
import { normalize } from "../packages/source-usc/src/schema.js";
import { validate } from "../packages/domain/src/validate.js";
import { response, course } from "./fixtures.js";

function reviewed() {
  const courses = normalize(20263, [response([course("CSCI426")])]);
  courses[0]!.programs = ["ENGV/CSCI"];
  courses[0]!.sections[0]!.d_clearance = true;
  courses[0]!.sections[0]!.registered_seats =
    courses[0]!.sections[0]!.total_seats;
  return validate(
    inputs.validate_schedule.parse({
      term_code: 20263,
      snapshot_version: "11111111-1111-4111-8111-111111111111",
      requested_courses: ["CSCI426"],
      section_ids: ["10001"],
    }),
    courses,
    courses[0]!.sections,
  );
}
it("shows separate unknown checks, full seats and official clearance links without promising approval", () => {
  const html = renderToStaticMarkup(
    React.createElement(ScheduleReview, { value: reviewed() }),
  );
  expect(html).toContain("Schedule compatibility");
  expect(html).toContain("Required components");
  expect(html).toContain("At least one section full");
  expect(html).toContain("D-clearance required · approval unknown");
  expect(html).toContain('href="https://www.cs.usc.edu/students/d-clearance/"');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).not.toContain("Modeled scheduling checks passed");
});
it("fails closed for an old or malformed review and never renders a tampered link", () => {
  const review = reviewed();
  review.availability[0]!.clearance.guidance.routes[0]!.url =
    "https://usc.edu.evil.test/login";
  for (const value of [review, { status: "feasible" }]) {
    const html = renderToStaticMarkup(
      React.createElement(ScheduleReview, { value }),
    );
    expect(html).toContain("Detailed validation is unavailable");
    expect(html).not.toContain("href=");
  }
});
it("escapes source text and visibly labels overdue guidance", () => {
  const review = reviewed();
  const route = review.availability[0]!.clearance.guidance.routes[0]!;
  route.title = '<img src=x onerror="alert(1)">';
  route.stale = true;
  const html = renderToStaticMarkup(
    React.createElement(ScheduleReview, { value: review }),
  );
  expect(html).toContain("&lt;img");
  expect(html).not.toContain("<img");
  expect(html).toContain("Due for re-verification");
});
afterEach(() => vi.useRealTimers());
it("coalesces rapid selection changes before sending a validation request", async () => {
  vi.useFakeTimers();
  const request = vi.fn(async () => "current"),
    states: ReviewState<string>[] = [];
  const cancel = observeValidation(request, (s) => states.push(s));
  cancel();
  const cancelLatest = observeValidation(request, (s) => states.push(s));
  await vi.advanceTimersByTimeAsync(350);
  expect(request).toHaveBeenCalledTimes(1);
  expect(states.at(-1)).toEqual({ status: "ready", value: "current" });
  cancelLatest();
});
it("aborts obsolete requests and ignores late successes even if the transport ignores cancellation", async () => {
  vi.useFakeTimers();
  let finish!: (value: string) => void, signal!: AbortSignal;
  const states: ReviewState<string>[] = [];
  const cancel = observeValidation(
    (s) => {
      signal = s;
      return new Promise<string>((r) => {
        finish = r;
      });
    },
    (s) => states.push(s),
  );
  await vi.advanceTimersByTimeAsync(350);
  cancel();
  expect(signal.aborted).toBe(true);
  const cancelLatest = observeValidation(
    async () => "new selection",
    (s) => states.push(s),
  );
  await vi.advanceTimersByTimeAsync(350);
  finish("old selection");
  await Promise.resolve();
  expect(states.at(-1)).toEqual({ status: "ready", value: "new selection" });
  expect(states).not.toContainEqual({
    status: "ready",
    value: "old selection",
  });
  cancelLatest();
});
it("replaces a previous success with a visible failure and ignores errors after teardown", async () => {
  vi.useFakeTimers();
  const states: ReviewState<string>[] = [];
  const cancel = observeValidation(
    async () => "previous",
    (s) => states.push(s),
  );
  await vi.advanceTimersByTimeAsync(350);
  cancel();
  const next = observeValidation<string>(
    async () => {
      throw new Error("Service offline");
    },
    (s) => states.push(s),
  );
  expect(states.at(-1)).toEqual({ status: "pending" });
  await vi.advanceTimersByTimeAsync(350);
  expect(states.at(-1)).toEqual({
    status: "error",
    message: "Service offline",
  });
  next();
  let fail!: (e: Error) => void;
  const stop = observeValidation<string>(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
    (s) => states.push(s),
  );
  await vi.advanceTimersByTimeAsync(350);
  stop();
  const count = states.length;
  fail(new Error("Late error"));
  await Promise.resolve();
  expect(states).toHaveLength(count);
});
