import { normalizeTee } from "./tee-selection";
import type { Course } from "./types";

/**
 * Tee-independent identity for a physical golf course.
 *
 * `Course.id` is slugify(name + tee), so one course has a row per tee — this database
 * already holds Genesee Valley South twice, once for White and once for Red. A green sits
 * in the same place whichever tee you played from, so geometry is keyed on this instead.
 *
 * `normalizeTee` is the same normaliser `samePhysicalCourse` uses to compare two courses;
 * the name is a leftover from where it started out.
 */
export function courseKey(course: Pick<Course, "name" | "location">): string {
  return `${normalizeTee(course.name)}|${normalizeTee(course.location)}`;
}
