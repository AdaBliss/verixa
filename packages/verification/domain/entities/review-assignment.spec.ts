import { createId } from "@verixa/shared-kernel";
import { describe, expect, it } from "vitest";
import {
  ReviewAssignment,
  type ReviewerId,
  type VerificationRequestId,
} from "./review-assignment.js";

describe("ReviewAssignment", () => {
  const requestId = createId<"VerificationRequestId">();
  const reviewerId = createId<"ReviewerId">();

  it("creates a valid review assignment with future expiration", () => {
    const assignedAt = new Date("2026-01-01T00:00:00Z");
    const claimExpiresAt = new Date("2026-01-01T00:30:00Z");

    const result = ReviewAssignment.create({
      requestId,
      reviewerId,
      assignedAt,
      claimExpiresAt,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.requestId).toBe(requestId);
      expect(result.value.reviewerId).toBe(reviewerId);
      expect(result.value.isActive(new Date("2026-01-01T00:15:00Z"))).toBe(true);
      expect(result.value.isExpired(new Date("2026-01-01T00:15:00Z"))).toBe(false);
    }
  });

  it("rejects assignment where expiration is before or equal to assignment time", () => {
    const assignedAt = new Date("2026-01-01T00:30:00Z");
    const claimExpiresAt = new Date("2026-01-01T00:00:00Z");

    const result = ReviewAssignment.create({
      requestId,
      reviewerId,
      assignedAt,
      claimExpiresAt,
    });

    expect(result.ok).toBe(false);
  });

  it("correctly identifies expiration status", () => {
    const assignedAt = new Date("2026-01-01T00:00:00Z");
    const claimExpiresAt = new Date("2026-01-01T00:30:00Z");

    const assignment = ReviewAssignment.create({
      requestId,
      reviewerId,
      assignedAt,
      claimExpiresAt,
    });

    if (!assignment.ok) throw new Error("setup failed");

    expect(assignment.value.isExpired(new Date("2026-01-01T00:29:59Z"))).toBe(false);
    expect(assignment.value.isExpired(new Date("2026-01-01T00:30:00Z"))).toBe(true);
    expect(assignment.value.isExpired(new Date("2026-01-01T00:35:00Z"))).toBe(true);
  });

  it("allows extending an active claim", () => {
    const assignedAt = new Date("2026-01-01T00:00:00Z");
    const claimExpiresAt = new Date("2026-01-01T00:30:00Z");

    const assignment = ReviewAssignment.create({
      requestId,
      reviewerId,
      assignedAt,
      claimExpiresAt,
    });

    if (!assignment.ok) throw new Error("setup failed");

    const extended = assignment.value.extend(new Date("2026-01-01T01:00:00Z"));
    expect(extended.ok).toBe(true);
    if (extended.ok) {
      expect(extended.value.claimExpiresAt).toEqual(new Date("2026-01-01T01:00:00Z"));
    }
  });
});
