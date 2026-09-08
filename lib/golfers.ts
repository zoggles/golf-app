import { z } from "zod";

/**
 * Who a request is acting as.
 *
 * There is no authentication yet: the browser names the golfer it has selected
 * and the server takes that at face value. `resolveGolferId` is the single
 * place that decision is made, and every stored row is scoped by what it
 * returns rather than by anything in a request body. Adding sign-in later means
 * reading a verified session here and ignoring the header — no route, query, or
 * table below this function has to change.
 */

export const GOLFER_HEADER = "x-golfer-id";

export interface Golfer {
  id: string;
  name: string;
}

export const golferNameSchema = z
  .string()
  .trim()
  .min(1, "Give the golfer a name.")
  .max(60, "That name is too long.");

export const golferPayloadSchema = z.object({ name: golferNameSchema });

/** A golfer id is a database uuid, so anything else is rejected outright. */
const golferIdSchema = z.uuid();

export class MissingGolferError extends Error {
  constructor() {
    super("No golfer selected.");
    this.name = "MissingGolferError";
  }
}

export function resolveGolferId(request: Request): string {
  const claimed = request.headers.get(GOLFER_HEADER)?.trim() ?? "";
  const parsed = golferIdSchema.safeParse(claimed);
  if (!parsed.success) throw new MissingGolferError();
  return parsed.data;
}
