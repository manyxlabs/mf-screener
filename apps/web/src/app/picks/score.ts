import type { ScoreResponse } from "@mf/shared";

export { getScore } from "@/lib/api";

/** A hoverable one-line-per-component explanation of why this total is what it is. */
export function scoreBreakdown(score: ScoreResponse): string {
  const lines = [`Total ${Math.round(score.total ?? 0)}/100 (${score.status})`];
  for (const [name, weight] of Object.entries(score.weights)) {
    const component = score.components[name];
    const points = (weight * 100).toFixed(0);
    if (!component || component.percentile === null) {
      lines.push(`${name}: missing (${component?.reason ?? "unavailable"}) of ${points} pts`);
    } else {
      lines.push(
        `${name}: ${component.contribution!.toFixed(1)} of ${points} pts ` +
          `(${Math.round(component.percentile * 100)}th percentile)`,
      );
    }
  }
  return lines.join("\n");
}
