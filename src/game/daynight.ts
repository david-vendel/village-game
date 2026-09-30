// Day and night. The time of day runs on its own clock, world.dayClock, which
// advances with the `timeSpeed` knob (so the day can be sped up without
// speeding up everything else). Phase 0 is midnight, 0.5 noon.
//
// The `nightHours` knob sets how long the sun stays below the horizon: 12 is
// an equinox, less is like a summer far north, 0 is the midnight sun (it just
// touches the horizon at midnight). It shapes the sun's path, so sunrise and
// sunset move while noon and midnight stay put.

import type { World } from './world';

/** Seconds of dayClock for one whole day and night (at time speed 1×). */
export const DAY_LENGTH = 300;
/** Seconds of dayClock per game hour. */
export const GAME_HOUR = DAY_LENGTH / 24;
/** Phase at dayClock 0: a new village starts early in the morning. */
const START_PHASE = 0.28;
/**
 * Game hours after sunrise, and before sunset, when it is still too dim to
 * work outdoors. Work hours follow the real sunrise and sunset, so with short
 * nights people work late into the long evening.
 */
const WORK_MARGIN = 0.5;

/** 0..1 through the day. */
export function dayPhase(world: World): number {
  return (((world.dayClock / DAY_LENGTH + START_PHASE) % 1) + 1) % 1;
}

/**
 * Sun height at a phase: 1 at noon, 0 at sunrise/sunset, lowest at midnight
 * (-1 with a 12-hour night, 0 with none).
 */
export function sunAltitude(phase: number, nightHours: number): number {
  // lift the plain cosine so it spends nightHours/24 of the day below 0
  const lift = Math.cos((Math.PI * Math.min(12, Math.max(0, nightHours))) / 24);
  return (-Math.cos(phase * Math.PI * 2) + lift) / (1 + lift);
}

/** Sunrise and sunset (game hours) with this many hours of night, centred on midnight. */
export function sunHours(nightHours: number): { rise: number; set: number } {
  const n = Math.min(12, Math.max(0, nightHours));
  return { rise: n / 2, set: 24 - n / 2 };
}

/** The sun's height right now. */
export function sunNow(world: World): number {
  return sunAltitude(dayPhase(world), world.params.nightHours);
}

/** Whether there is light enough for outdoor work: from just after sunrise to just before sunset. */
export function isWorkTime(world: World): boolean {
  const hour = dayPhase(world) * 24;
  const { rise, set } = sunHours(world.params.nightHours);
  return hour > rise + WORK_MARGIN && hour < set - WORK_MARGIN;
}

/** Day number (from 1) and clock time, for display. */
export function clock(world: World): { day: number; hours: number; minutes: number } {
  const days = world.dayClock / DAY_LENGTH + START_PHASE;
  const minutesOfDay = Math.floor(dayPhase(world) * 24 * 60);
  return { day: Math.floor(days) + 1, hours: Math.floor(minutesOfDay / 60), minutes: minutesOfDay % 60 };
}

/** The time of day as villagers see it: enough to plan their day by. */
export interface TimeOfDay {
  /** Light enough for outdoor work. */
  daylight: boolean;
  /** Day number (from 1) and hour of the day, 0..24 (fractional). */
  day: number;
  hour: number;
  /** Game hours that pass per second of simulation (follows the time speed). */
  hoursPerSecond: number;
}

export function timeOfDay(world: World): TimeOfDay {
  return {
    daylight: isWorkTime(world),
    day: clock(world).day,
    hour: dayPhase(world) * 24,
    hoursPerSecond: (24 / DAY_LENGTH) * world.params.timeSpeed,
  };
}
