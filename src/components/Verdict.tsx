import { Alert } from 'antd';
import type { FishingScore } from '../domain/score';
import { scoreBand } from '../domain/units';

interface VerdictProps {
  score: FishingScore;
  /** One-sentence plain-language summary of the moment. */
  summary: string;
}

/**
 * The headline call.
 *
 * The word leads and the number follows it, quietly: anglers decide on
 * "prime" or "poor", and the figure is only there to rank one hour against
 * another. What the score is built from sits in the readings below, where each
 * row carries its own contribution.
 */
export function Verdict({ score, summary }: VerdictProps) {
  const band = scoreBand(score.score);

  return (
    <div>
      <div className="verdict">
        <span className={`word tone-${band.tone}`}>{band.label}</span>
        <span className="num">{score.score}</span>
      </div>
      <p className="verdict-sub">{summary}</p>

      {score.unfishable && (
        <Alert
          className="gate"
          type="error"
          showIcon={false}
          title={`${score.gateReason}.`}
          description="Not worth going, and not safe on exposed ground."
        />
      )}
    </div>
  );
}
