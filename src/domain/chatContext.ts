import { FAR_ANCHOR_KM, type SnapResult } from '../api/oceanSnap';
import type { LatLon, TimelinePoint } from '../api/types';
import type { LightWindow } from './daylight';
import { describeConditions } from './describe';
import { scoreHour, type FishingWindow } from './score';
import { currentIndex } from './timeline';
import type { TideExtreme } from './tides';
import {
  epochToSpotDay,
  epochToSpotTime,
  formatDay,
  formatHour,
  formatLatLon,
  scoreBand,
  toCompass,
} from './units';

/** How far ahead the assistant is given, matching the horizon the app scores. */
const HORIZON_HOURS = 48;

export interface ChatContextInput {
  spot: LatLon;
  /** The name it was saved under, when it has one. */
  spotName: string | null;
  timeline: TimelinePoint[];
  extremes: TideExtreme[];
  windows: FishingWindow[];
  /** The dawn and dusk windows, so the assistant's scores match the page's. */
  light: LightWindow[];
  snap: SnapResult | null;
  utcOffsetSeconds: number;
  timezone: string;
  /** Epoch ms. Passed in rather than read, so the output is a function of it. */
  now: number;
}

/** "+10:00" — the offset as the reader of a forecast expects to see it. */
function formatOffset(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+';
  const total = Math.abs(Math.round(seconds / 60));
  return `${sign}${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function signed(metres: number): string {
  return `${metres >= 0 ? '+' : ''}${metres.toFixed(2)} m`;
}

/**
 * One hour as a single line.
 *
 * Fields are dropped rather than written as "--" when the model had nothing:
 * an absent field reads as absent, where a placeholder invites the assistant
 * to talk about it.
 */
function hourLine(point: TimelinePoint, extremes: TideExtreme[], light: LightWindow[]): string {
  const parts = [`${formatDay(point.time)} ${formatHour(point.time)}`];
  parts.push(`score ${scoreHour(point, extremes, light).score}`);

  if (point.windSpeed !== null) {
    const gust = point.windGust === null ? '' : `, gusting ${Math.round(point.windGust)}`;
    parts.push(`wind ${toCompass(point.windDir)} ${Math.round(point.windSpeed)} kn${gust}`);
  }
  if (point.waveHeight !== null) {
    const period = point.wavePeriod === null ? '' : ` at ${point.wavePeriod.toFixed(0)} s`;
    parts.push(`swell ${point.waveHeight.toFixed(1)} m${period}`);
  }
  if (point.tideHeight !== null) {
    const rate =
      point.tideRate === null
        ? ''
        : `, ${point.tideRate > 0 ? 'rising' : 'falling'} ${Math.abs(point.tideRate).toFixed(2)} m/hr`;
    parts.push(`tide ${signed(point.tideHeight)}${rate}`);
  }
  if (point.precip !== null) {
    const chance = point.precipProb === null ? '' : ` (${Math.round(point.precipProb)}% chance)`;
    parts.push(`rain ${point.precip.toFixed(1)} mm${chance}`);
  }
  if (point.temp !== null) parts.push(`${Math.round(point.temp)}°C`);

  return parts.join(' | ');
}

/**
 * Everything the app knows about one spot, as text an assistant can read.
 *
 * It is written from the same functions the screen is: the scores, the tide
 * turns, the windows and the summary sentence all come from the domain rather
 * than being recomputed here. If the panel and the page ever disagreed about
 * a number, the answer would be worth less than no answer at all.
 *
 * Nothing volatile beyond the conditions goes in — no wall-clock stamp of
 * when the request was made, no request id — because this string is the
 * cached half of every prompt, and one changing byte would cost the cache.
 */
export function buildChatContext(input: ChatContextInput): string {
  const {
    spot, spotName, timeline, extremes, windows, light, snap,
    utcOffsetSeconds, timezone, now,
  } = input;

  // The current hour is picked the way the page picks it, so the two cannot
  // disagree about which reading "now" means. Everything downstream is then
  // measured from that hour rather than from the clock, which is also what
  // keeps this string still between ticks: the readings are hourly, so a
  // minute passing is not a reason to rewrite — and pay for — the prompt.
  const index = currentIndex(timeline, now);
  const current =
    index >= 0 && Math.abs(timeline[index].t - now) <= 3600_000 ? timeline[index] : null;
  const ahead = current
    ? timeline.slice(index).filter((p) => p.t <= current.t + HORIZON_HOURS * 3600_000)
    : [];

  const lines: string[] = [];

  lines.push('SPOT');
  if (spotName) lines.push(`Saved as: ${spotName}`);
  lines.push(`Position: ${formatLatLon(spot.lat, spot.lon)}`);
  lines.push(`Local time zone: ${timezone} (UTC${formatOffset(utcOffsetSeconds)})`);

  if (snap && snap.anchor === null) {
    lines.push(
      'No marine data: this spot is too far inland for the wave model, so there is no swell or tide here — only wind and rain.',
    );
  } else if (snap && snap.distanceKm > FAR_ANCHOR_KM) {
    lines.push(
      `Swell and tide are measured ${snap.distanceKm.toFixed(0)} km away, at the nearest cell the wave model covers. Wind and rain are for the spot itself. Treat the marine figures as the open water nearby rather than this exact place, and say so if they decide the answer.`,
    );
  }

  if (current) {
    const score = scoreHour(current, extremes, light);
    lines.push('', 'NOW');
    lines.push(`${formatDay(current.time)} ${formatHour(current.time)} local`);
    lines.push(`Score ${score.score}/100 (${scoreBand(score.score).label})`);
    lines.push(
      describeConditions(current, extremes, timeline, now, utcOffsetSeconds, score.score, light),
    );
    if (score.gateReason) {
      lines.push(`Unfishable: ${score.gateReason}. The score is capped regardless of everything else.`);
    }
    for (const factor of score.factors) {
      const weight = factor.value === null ? 'no data' : `${Math.round(factor.value * 100)}/100`;
      lines.push(`- ${factor.label}: ${weight} — ${factor.detail}`);
    }
  }

  lines.push('', `HOURLY, NEXT ${HORIZON_HOURS} HOURS`);
  for (const point of ahead) lines.push(hourLine(point, extremes, light));

  const from = current?.t ?? now;
  const horizonEnd = from + HORIZON_HOURS * 3600_000;
  /** A time far enough out that a bare clock reading would be read as tomorrow. */
  const stamp = (t: number) =>
    `${epochToSpotDay(t, utcOffsetSeconds, 'short')} ${epochToSpotTime(t, utcOffsetSeconds)}`;

  const turns = extremes.filter((e) => e.t >= from && e.t <= horizonEnd);
  lines.push('', 'TIDE TURNS');
  if (turns.length === 0) {
    lines.push('None in range.');
  } else {
    for (const turn of turns) {
      lines.push(
        `${turn.kind === 'high' ? 'High' : 'Low'} ${stamp(turn.t)} at ${signed(turn.height)}`,
      );
    }
  }

  // Only the windows this block has hourly readings behind. The app searches
  // as far ahead as the chart is set to show, which can be a week; a window
  // listed here that the HOURLY section stops short of would be a score with
  // nothing under it, and the times carry no year — "5:00am" three days out
  // reads as tomorrow morning and gets answered as if it were.
  const inRange = windows.filter((w) => w.startT <= horizonEnd);

  lines.push('', 'BEST WINDOWS (the app’s own pick, strongest first)');
  if (inRange.length === 0) {
    lines.push('None — nothing in range scores well enough to call a window.');
  } else {
    for (const window of inRange) {
      lines.push(
        `${stamp(window.startT)} to ${epochToSpotTime(window.endT, utcOffsetSeconds)}, averaging ${window.score}/100, best at ${epochToSpotTime(window.peakT, utcOffsetSeconds)}`,
      );
    }
  }
  if (inRange.length < windows.length) {
    lines.push(
      `The app found ${windows.length - inRange.length} more beyond the ${HORIZON_HOURS} hours above. Say that rather than describing them.`,
    );
  }

  return lines.join('\n');
}
