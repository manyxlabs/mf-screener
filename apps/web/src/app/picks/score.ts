import type { ScoreResponse } from "@mf/shared";

export { getScore } from "@/lib/api";

/** A hoverable one-line-per-component explanation of why this total is what it is. */
export function scoreBreakdown(score: ScoreResponse): string {
  // Every component is a percentile inside this peer group, so the group is the
  // score's meaning, not context for it. A grab-bag sub-category such as "FoF
  // Domestic" puts a Nasdaq feeder among gold and debt funds, and the resulting
  // percentile is close to meaningless - which is only visible if the group is named.
  const lines = [
    `Total ${Math.round(score.total ?? 0)}/100 (${score.status})`,
    `Ranked against ${score.peer_count} funds in ${score.sub_category}`,
  ];
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
