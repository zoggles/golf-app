import { z } from "zod";

/** Request-body validation for the course geometry route. */

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

// The course key is a client-supplied primary key, so its shape is pinned down rather than
// trusted. `normalizeTee` only ever emits lowercase alphanumerics and single spaces.
const courseKeySchema = z
  .string()
  .min(3)
  .max(200)
  .regex(/^[a-z0-9 ]+\|[a-z0-9 ]*$/, "Course key must be a normalised name and location.");

const scorecardHoleSchema = z.object({
  number: z.number().int().min(1).max(18),
  par: z.number().int().min(3).max(6),
  yards: z.number().int().min(0).max(1000),
  handicap: z.number().int().min(1).max(18),
});

export const geometryResolveSchema = z.object({
  courseKey: courseKeySchema,
  fix: latLngSchema,
  holes: z.array(scorecardHoleSchema).min(1).max(18),
});

export const geometryPinSchema = z.object({
  courseKey: courseKeySchema,
  holeNumber: z.number().int().min(1).max(18),
  green: latLngSchema,
  tee: latLngSchema.optional(),
});

export type GeometryResolveRequest = z.infer<typeof geometryResolveSchema>;
export type GeometryPinRequest = z.infer<typeof geometryPinSchema>;

export function parseGeometryResolve(value: unknown): GeometryResolveRequest {
  return geometryResolveSchema.parse(value);
}

export function parseGeometryPin(value: unknown): GeometryPinRequest {
  return geometryPinSchema.parse(value);
}
