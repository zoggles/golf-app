import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a server component graph; this test IS the server path.
vi.mock("server-only", () => ({}));

// Load .env.local the way next dev does, so the real Supabase helpers can reach the project.
beforeAll(() => {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
});

/**
 * Live end-to-end check of the geometry pipeline.
 *
 * Skipped by default: it calls the real Overpass API and writes to the real Supabase
 * project, neither of which belongs in `npm test`. Run it deliberately when the pipeline
 * changes, with:
 *
 *     CADDY_E2E=1 npx vitest run lib/course-geometry.e2e.test.ts
 */
describe.skipIf(!process.env.CADDY_E2E)("geometry pipeline, end to end", () => {
  it("fetches Durand Eastman from Overpass, normalises it, and round-trips the database", async () => {
    const { runOverpass, courseAndHolesQuery } = await import("./overpass");
    const { normalizeOsmCourse } = await import("./osm-normalize");
    const { saveCourseGeometryRow, saveCourseGeometryLink, readCourseGeometryBundle } =
      await import("./supabase-server");

    const fix = { lat: 43.232882, lng: -77.571926 };
    const elements = await runOverpass(courseAndHolesQuery(fix.lat, fix.lng));
    console.log("overpass elements:", elements.length);

    const holes = [
      [1,4,371,13],[2,4,405,3],[3,4,250,15],[4,5,451,1],[5,3,128,17],[6,4,300,11],
      [7,4,325,7],[8,3,170,9],[9,4,365,5],[10,4,398,4],[11,4,352,8],[12,3,155,12],
      [13,4,390,2],[14,4,315,10],[15,4,292,14],[16,4,225,16],[17,3,105,18],[18,5,467,6],
    ].map(([number, par, yards, handicap]) => ({ number, par, yards, handicap }));

    const result = normalizeOsmCourse({ elements, fix, holes });
    console.log("course:", result.geometry.id, result.geometry.name);
    console.log("holes:", result.geometry.holes.length, "hazards:", result.geometry.hazards.length);
    console.log("unmatched:", result.unmatched);
    expect(result.unmatched).toEqual([]);

    const courseKey = "durand eastman golf course|rochester new york";
    await saveCourseGeometryRow(result.geometry);
    await saveCourseGeometryLink({
      courseKey,
      geometryId: result.geometry.id,
      holeMap: result.holeMap,
      matchedBy: "gps",
    });

    const bundle = await readCourseGeometryBundle(courseKey);
    expect(bundle).not.toBeNull();
    expect(bundle!.geometry.holes).toHaveLength(result.geometry.holes.length);
    expect(Object.keys(bundle!.holeMap)).toHaveLength(18);
    expect(bundle!.geometry.attribution).toContain("OpenStreetMap");

    // The shot engine has to work off what came back out of the database, not off the
    // in-memory object, or a serialisation slip would go unnoticed until somebody is on a tee.
    const { playingHole } = await import("./hole-geometry");
    const { planShot } = await import("./shot-engine");
    const { DEFAULT_BAG } = await import("./bag");
    const second = playingHole(bundle!, 2)!;
    const plan = planShot({ from: second.tee, hole: second, hazards: bundle!.geometry.hazards, bag: DEFAULT_BAG, accuracyM: 5 });
    console.log(`hole 2 from the tee: ${plan.club?.club.label}, ${Math.round(plan.targetYds)}yd target, green ${Math.round(plan.green.frontYds)}/${Math.round(plan.green.centreYds)}/${Math.round(plan.green.backYds)} [${plan.kind}]`);
    expect(plan.club).not.toBeNull();
    expect(plan.green.frontYds).toBeLessThan(plan.green.backYds);
  }, 120_000);
});
