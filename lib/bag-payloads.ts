import { z } from "zod";
import { MAX_SHOTS_PER_CLUB } from "./bag";

/**
 * Request-body validation for /api/bag. Looser than the app's own limits on purpose: the
 * route stores what normalizeBag will accept, and normalizeBag does the clamping.
 */

const shotSchema = z.object({
  yds: z.number(),
  at: z.iso.datetime({ offset: true }),
});

const clubSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(60),
  carryYds: z.number(),
  shots: z.array(shotSchema).max(MAX_SHOTS_PER_CLUB * 2).optional(),
});

export const bagPayloadSchema = z.object({
  bag: z.object({
    clubs: z.array(clubSchema).min(1).max(30),
    updatedAt: z.iso.datetime({ offset: true }),
  }),
});
