import { z } from "zod";
import type { Course, GolfRound } from "./types";

/** Request-body validation for the persistence routes. */

const holeSchema = z.object({
  number: z.number().int().min(1).max(18),
  par: z.number().int().min(3).max(6),
  yards: z.number().int().min(0).max(1000),
  handicap: z.number().int().min(1).max(18),
  suggestedClub: z.string(),
  strategy: z.string(),
});

export const coursePayloadSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  shortName: z.string().min(1),
  location: z.string(),
  tee: z.string(),
  rating: z.number(),
  slope: z.number().int(),
  par: z.number().int(),
  yards: z.number().int(),
  sourceUrl: z.string(),
  holes: z.array(holeSchema).min(1),
});

const eventSchema = z.object({
  id: z.string().min(1),
  at: z.string().min(1),
  source: z.enum(["voice", "manual"]),
  text: z.string(),
  hole: z.number().int().optional(),
  strokes: z.number().int().optional(),
});

export const gamePayloadSchema = z.object({
  id: z.string().min(1),
  courseId: z.string().min(1),
  courseName: z.string().min(1),
  location: z.string(),
  segment: z.enum(["front9", "back9", "full18"]),
  tee: z.string(),
  courseRating: z.number(),
  courseSlope: z.number().int(),
  course: coursePayloadSchema,
  startedAt: z.string().min(1),
  completedAt: z.string().optional(),
  status: z.enum(["active", "completed"]),
  scores: z.record(z.string(), z.number()),
  events: z.array(eventSchema),
});

export function parseCoursePayload(value: unknown): Course {
  return coursePayloadSchema.parse(value) as unknown as Course;
}

export function parseGamePayload(value: unknown): GolfRound {
  return gamePayloadSchema.parse(value) as unknown as GolfRound;
}
