import { describe, expect, it } from "vitest";

import { AttributeContext } from "./attribute-context.js";

describe("AttributeContext", () => {
  it("supports typed lookups across all four attribute categories", () => {
    const context = AttributeContext.create({
      subject: { id: "user-1", role: "admin" },
      resource: { ownerId: "user-2", sensitivity: "high" },
      action: { name: "read" },
      environment: { requestedAt: new Date("2026-01-01T00:00:00Z") },
    });

    expect(context.get("subject", "id")).toBe("user-1");
    expect(context.get("resource", "ownerId")).toBe("user-2");
    expect(context.get("action", "name")).toBe("read");
    expect(context.get("environment", "requestedAt")).toEqual(new Date("2026-01-01T00:00:00Z"));
  });

  it("supports string, number, boolean, date, and array attribute values", () => {
    const context = AttributeContext.create({
      resource: {
        name: "doc-1",
        views: 42,
        locked: false,
        availableFrom: new Date("2026-01-01T00:00:00Z"),
        tags: ["a", "b"],
      },
    });

    expect(context.get("resource", "name")).toBe("doc-1");
    expect(context.get("resource", "views")).toBe(42);
    expect(context.get("resource", "locked")).toBe(false);
    expect(context.get("resource", "availableFrom")).toBeInstanceOf(Date);
    expect(context.get("resource", "tags")).toEqual(["a", "b"]);
  });

  it("returns undefined, not throwing, for a missing attribute", () => {
    const context = AttributeContext.create({ subject: { id: "user-1" } });
    expect(context.get("subject", "role")).toBeUndefined();
  });

  it("defaults every unsupplied category to an empty bag", () => {
    const context = AttributeContext.create({});
    expect(context.get("subject", "id")).toBeUndefined();
    expect(context.get("resource", "id")).toBeUndefined();
    expect(context.get("action", "name")).toBeUndefined();
    expect(context.get("environment", "now")).toBeUndefined();
  });

  describe("resolve", () => {
    it("resolves a dotted path to the matching category and key", () => {
      const context = AttributeContext.create({ resource: { ownerId: "user-2" } });
      expect(context.resolve("resource.ownerId")).toBe("user-2");
    });

    it("resolves a key that itself contains dots by treating only the first segment as the category", () => {
      const context = AttributeContext.create({ resource: { "metadata.key": "value" } });
      expect(context.resolve("resource.metadata.key")).toBe("value");
    });

    it("returns undefined for an unrecognized category", () => {
      const context = AttributeContext.create({ resource: { ownerId: "user-2" } });
      expect(context.resolve("nonexistentCategory.ownerId")).toBeUndefined();
    });

    it("returns undefined for a path with no category separator", () => {
      const context = AttributeContext.create({ resource: { ownerId: "user-2" } });
      expect(context.resolve("ownerId")).toBeUndefined();
    });

    it("returns undefined for a missing key within a recognized category", () => {
      const context = AttributeContext.create({ resource: { ownerId: "user-2" } });
      expect(context.resolve("resource.sensitivity")).toBeUndefined();
    });
  });
});
