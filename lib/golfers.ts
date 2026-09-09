import { z } from "zod";

export interface Golfer {
  id: string;
  name: string;
  accountId?: string;
}

export const golferNameSchema = z
  .string()
  .trim()
  .min(1, "Give the golfer a name.")
  .max(60, "That name is too long.");

export const golferPayloadSchema = z.object({ name: golferNameSchema });
