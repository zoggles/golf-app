export type RoundSegment = "front9" | "back9" | "full18";
export type RoundStatus = "active" | "completed";

export interface Hole {
  number: number;
  par: number;
  yards: number;
  handicap: number;
  suggestedClub: string;
  strategy: string;
}

export interface Course {
  id: string;
  name: string;
  shortName: string;
  location: string;
  tee: string;
  rating: number;
  slope: number;
  par: number;
  yards: number;
  sourceUrl: string;
  holes: Hole[];
}

export interface HoleMetrics {
  putts?: number;
  penaltyStrokes?: number;
  fairway?: "hit" | "miss";
  blowUp?: boolean;
}

export interface RoundEvent {
  id: string;
  at: string;
  source: "voice" | "manual";
  text: string;
  hole?: number;
  strokes?: number;
  metrics?: HoleMetrics;
}

export interface GolfRound {
  id: string;
  courseId: string;
  courseName: string;
  location: string;
  segment: RoundSegment;
  tee: string;
  courseRating: number;
  courseSlope: number;
  course: Course;
  startedAt: string;
  completedAt?: string;
  status: RoundStatus;
  scores: Record<number, number>;
  events: RoundEvent[];
}

export interface GolfData {
  version: 2;
  activeRoundId: string | null;
  rounds: GolfRound[];
  courses: Course[];
}
