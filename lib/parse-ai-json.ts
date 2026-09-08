import type { ZodType } from "zod";

export function parseAiJson<T>(text: string, schema: ZodType<T>): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The model did not return a JSON object.");
  const parsed: unknown = JSON.parse(fenced.slice(start, end + 1));
  return schema.parse(parsed);
}
