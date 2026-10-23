import { describe, expect, it } from "vitest";
import { BoundedMap } from "../src/core/cache";

describe("bounded cache", () => {
  it("evicts the oldest entry once the limit is exceeded", () => {
    const cache = new BoundedMap<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.size).toBe(2);
    expect(cache.has("a")).toBe(false);
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("keeps recently read entries alive", () => {
    const cache = new BoundedMap<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
  });

  it("does not grow when a key is overwritten", () => {
    const cache = new BoundedMap<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10);
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBe(10);
  });

  it("supports delete and clear", () => {
    const cache = new BoundedMap<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.delete("a")).toBe(true);
    expect(cache.has("a")).toBe(false);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("rejects an invalid limit", () => {
    expect(() => new BoundedMap<string, number>(0)).toThrow(RangeError);
    expect(() => new BoundedMap<string, number>(1.5)).toThrow(RangeError);
  });
});
