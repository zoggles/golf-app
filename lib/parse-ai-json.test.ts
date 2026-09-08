import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseAiJson } from "./parse-ai-json";

const schema = z.object({ value: z.number() });

describe("parseAiJson", () => {
  it("extracts a validated object from plain JSON", () => {
    expect(parseAiJson('{"value":4}', schema)).toEqual({ value: 4 });
  });

  it("accepts a fenced model response", () => {
    expect(parseAiJson('```json\n{"value":5}\n```', schema)).toEqual({ value: 5 });
  });

  it("rejects data outside the required schema", () => {
    expect(() => parseAiJson('{"value":"five"}', schema)).toThrow();
  });
});
