import type { Course, Hole, RoundSegment } from "./types";

const hole = (
  number: number,
  par: number,
  yards: number,
  handicap: number,
  suggestedClub: string,
  strategy: string,
): Hole => ({ number, par, yards, handicap, suggestedClub, strategy });

export const GENESEE_VALLEY_SOUTH: Course = {
  id: "genesee-valley-south",
  name: "Genesee Valley Golf Course — South",
  shortName: "Genesee Valley South",
  location: "Rochester, NY",
  tee: "White",
  rating: 65.2,
  slope: 109,
  par: 67,
  yards: 5230,
  sourceUrl:
    "https://monroecountyparksgolf.com/wp-content/uploads/2023/02/Genesee-Valley-S-N-6x12_23-v6-02.14-proof.pdf",
  holes: [
    hole(1, 4, 370, 5, "Driver", "Favor the left-center and leave a comfortable approach."),
    hole(2, 4, 333, 15, "Driver", "A controlled tee ball creates a short scoring approach."),
    hole(3, 3, 222, 7, "Hybrid", "Take enough club; the center of the green is the smart target."),
    hole(4, 3, 180, 11, "5 iron", "Play for the middle and let distance control do the work."),
    hole(5, 4, 251, 17, "3 wood", "Position beats power here—choose your favorite wedge number."),
    hole(6, 4, 371, 1, "Driver", "The front side’s toughest hole rewards a committed tee shot."),
    hole(7, 4, 338, 9, "Driver", "Center-cut is ideal; avoid forcing the approach."),
    hole(8, 4, 325, 13, "Driver", "A smooth drive leaves a confident short iron."),
    hole(9, 4, 435, 3, "Driver", "Length matters, but a playable second shot matters more."),
    hole(10, 4, 305, 6, "3 wood", "Pick a club that keeps the ball in play off the tee."),
    hole(11, 3, 110, 18, "Pitching wedge", "Trust the yardage and favor the center."),
    hole(12, 4, 290, 16, "3 wood", "A positional tee shot can turn this into a birdie look."),
    hole(13, 3, 153, 8, "7 iron", "Choose the club that comfortably covers the front edge."),
    hole(14, 3, 157, 10, "7 iron", "Middle-green distance is the right number."),
    hole(15, 4, 385, 2, "Driver", "Stay patient on one of the inward side’s hardest holes."),
    hole(16, 4, 315, 12, "3 wood", "Find the fairway first, then attack with a wedge."),
    hole(17, 4, 305, 14, "3 wood", "A controlled tee shot sets up the best angle."),
    hole(18, 4, 385, 4, "Driver", "Finish with a committed target and a balanced swing."),
  ],
};

export const COURSES = [GENESEE_VALLEY_SOUTH];

export function getCourse(courseId: string): Course {
  return COURSES.find((course) => course.id === courseId) ?? GENESEE_VALLEY_SOUTH;
}

export function getSegmentHoles(course: Course, segment: RoundSegment): Hole[] {
  if (segment === "front9") return course.holes.slice(0, 9);
  if (segment === "back9") return course.holes.slice(9, 18);
  return course.holes;
}

export function segmentLabel(segment: RoundSegment): string {
  if (segment === "front9") return "Front 9";
  if (segment === "back9") return "Back 9";
  return "Full 18";
}
