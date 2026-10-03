// Airworthiness: how well agents fly on a vendor's product, from real crash
// and rescue data. Pure functions, usable on server and client. The rating
// cannot be bought: it only moves when agents stop going down or get rescued.

export type Grade = "A" | "B" | "C" | "D" | "F" | "—";

export type RatingInput = {
  maydays: number;
  rescues: number;
  minutes_lost: number;
  sites: number;
  // Maydays that happened at crash sites where the vendor has pinned an official fix.
  covered_maydays: number;
  covered_sites: number;
};

export type Rating = RatingInput & {
  score: number | null; // 0..100, null when there is no traffic to rate
  grade: Grade;
  rescue_rate: number; // 0..1
  coverage: number; // 0..1, share of maydays at sites with an official fix
  avg_minutes_lost: number;
  summary: string;
};

export function gradeFor(score: number | null): Grade {
  // An unclaimed airspace with a typical rescue rate lands at C: there is
  // nothing pinned yet, not something broken. Pinning official fixes where
  // agents crash most moves it to B, and a high rescue rate to A.
  if (score === null) return "—";
  if (score >= 75) return "A";
  if (score >= 55) return "B";
  if (score >= 30) return "C";
  if (score >= 15) return "D";
  return "F";
}

// 55% rescue rate, 30% official-fix coverage, 15% how cheap a crash is.
export function rate(input: RatingInput): Rating {
  const { maydays, rescues, minutes_lost, covered_maydays } = input;
  if (maydays <= 0) {
    return {
      ...input,
      score: null,
      grade: "—",
      rescue_rate: 0,
      coverage: 0,
      avg_minutes_lost: 0,
      summary: "No agent traffic recorded yet, so there is nothing to rate.",
    };
  }
  const rescue_rate = Math.min(1, rescues / maydays);
  const coverage = Math.min(1, covered_maydays / maydays);
  const avg_minutes_lost = minutes_lost / maydays;
  const cheapness = 1 - Math.min(avg_minutes_lost, 30) / 30;
  const score = Math.round(100 * (0.55 * rescue_rate + 0.3 * coverage + 0.15 * cheapness));
  const grade = gradeFor(score);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const summary =
    `${pct(rescue_rate)} of agents that went down were rescued, ` +
    `${pct(coverage)} of crashes happened where an official fix is pinned, ` +
    `and a crash costs ${avg_minutes_lost.toFixed(1)} agent-minutes on average.`;
  return { ...input, score, grade, rescue_rate, coverage, avg_minutes_lost, summary };
}

// Data colours for a grade, as CSS variable names from globals.css.
export function gradeTone(grade: Grade): "rescue" | "flare" | "distress" | "mute" {
  if (grade === "A" || grade === "B") return "rescue";
  if (grade === "C") return "flare";
  if (grade === "D" || grade === "F") return "distress";
  return "mute";
}
