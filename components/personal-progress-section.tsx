import Link from "next/link";
import { CaretRight } from "@phosphor-icons/react";
import { ScoreTrend } from "@/components/score-trend";
import { formatToPar } from "@/lib/metrics";
import { courseProgress, formatProgress, MIN_SAMPLES, type CourseProgress, type FormatProgress } from "@/lib/personal-baseline";
import { formatLabel } from "@/lib/round-format";
import { EVEN_BAND, formatAverage, formatVsAverage, toneOf } from "@/lib/round-story";
import type { GolfRound } from "@/lib/types";

/**
 * You against yourself across every round: which way your nines and eighteens are heading, and
 * how you do at the courses you keep going back to.
 */
export function PersonalProgressSection({ rounds }: { rounds: GolfRound[] }) {
  const formats = [formatProgress(rounds, 18), formatProgress(rounds, 9)].filter((progress) => progress.rounds > 0);
  const courses = courseProgress(rounds);
  if (!formats.length) return null;

  return (
    <section className="personal-progress" aria-label="You vs you">
      <div className="section-heading">
        <div>
          <h2>You vs you</h2>
          <p>Par tells you how you compare to golf. This tells you whether you’re getting better, using only your own finished rounds.</p>
        </div>
      </div>

      <div className={formats.length > 1 ? "format-progress-grid two" : "format-progress-grid"}>
        {formats.map((progress) => <FormatProgressCard key={progress.holes} progress={progress} />)}
      </div>

      {courses.length ? (
        <div className="course-progress surface-card">
          <h3>Courses you keep coming back to</h3>
          <ul>{courses.map((course) => <CourseRow key={course.key} course={course} />)}</ul>
        </div>
      ) : null}
    </section>
  );
}

function FormatProgressCard({ progress }: { progress: FormatProgress }) {
  return (
    <article className="format-progress surface-card">
      <header>
        <h3>{progress.holes}-hole rounds</h3>
        <span>{progress.rounds} played</span>
      </header>
      <dl className="format-stats">
        <div>
          <dt>Last {Math.min(progress.rounds, 5)} avg</dt>
          <dd>{progress.lastFive === null ? "—" : formatVsAverage(progress.lastFive)}</dd>
          <small>{progress.lastFive === null ? `After ${MIN_SAMPLES} rounds` : "vs par"}</small>
        </div>
        {progress.lastTen !== null ? (
          <div>
            <dt>Last {Math.min(progress.rounds, 10)} avg</dt>
            <dd>{formatVsAverage(progress.lastTen)}</dd>
            <small>vs par</small>
          </div>
        ) : null}
        {progress.best ? (
          <div>
            <dt>Best</dt>
            <dd>{progress.best.total}</dd>
            <small title={progress.best.courseName}>{formatToPar(progress.best.toPar)} · {progress.best.courseName}</small>
          </div>
        ) : null}
      </dl>
      <ScoreTrend trend={progress.trend} />
    </article>
  );
}

function CourseRow({ course }: { course: CourseProgress }) {
  const tone = toneOf(course.lastVsAverage, EVEN_BAND);
  return (
    <li>
      <Link href={`/rounds/${course.last.roundId}`} className="course-progress-row" aria-label={`Open your latest round at ${course.courseName}`}>
        <span className="course-progress-name">
          <strong>{course.courseName}</strong>
          <small>{formatLabel(course.segment, course.holes)} · {course.rounds} rounds</small>
        </span>
        <span className="course-progress-stat">
          <small>AVG</small>
          <strong>{course.average === null ? "—" : formatAverage(course.average)}</strong>
        </span>
        <span className="course-progress-stat">
          <small>BEST</small>
          <strong>{course.best}</strong>
        </span>
        <span className="course-progress-stat">
          <small>LAST</small>
          <strong>{course.last.total}</strong>
          {course.lastVsAverage !== null ? <em className={tone ?? undefined}>{formatVsAverage(course.lastVsAverage)} vs avg</em> : null}
        </span>
        <CaretRight className="round-open-icon" size={16} />
      </Link>
    </li>
  );
}
