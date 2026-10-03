// What is going on inside a building, as far as anyone outside can see: a
// fire in the hearth (smoke from the chimney, a glow through an open door), a
// furnace at work (the bakery's oven, the forge, the watch's brazier), lamps
// and firelight in the windows, and whether the shutters stand open.
//
// Derived, never stored: from the time of day and from the people who live
// and work there (worker.ts). A household is up before dawn to light the
// fire, cooks at noon, sits by the fire after dark until bedtime, and sleeps
// with the fire out and the shutters closed. A workplace's people live there
// the same way; one nobody works at stays cold and shut. Each household keeps
// its own hours a little (by the building's id).

import { BUILDINGS } from './buildings';
import { dayPhase, isWorkTime, sunHours, sunNow } from './daynight';
import { employees } from './people';
import type { Building, World } from './world';

export interface Hearth {
  /** 0..1: the fire in the hearth (smoke from the chimney: none without it). */
  hearth: number;
  /** 0..1: a furnace burning (the oven, the forge, a brazier): its glow and its own smoke. */
  furnace: number;
  /** 0..1: lamps and firelight in the windows. */
  light: number;
  /** 0 shut … 1 open. */
  shutters: number;
  /** How many are asleep inside. */
  asleep: number;
  /** 0..1: the lantern by the door: lit from dusk until about one in the morning, all night at an inn, a chapel, a watch. */
  lantern: number;
}

const NONE: Hearth = { hearth: 0, furnace: 0, light: 0, shutters: 0, asleep: 0, lantern: 0 };

/** A number 0..1 that stays the same for a building (its household's habits). */
const habit = (id: number, salt: number) => {
  const s = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** The household's day: when it gets up and goes to bed (game hours). */
function hours(world: World, b: Building): { hour: number; wake: number; bed: number; dark: boolean } {
  const hour = dayPhase(world) * 24;
  const { rise } = sunHours(world.params.nightHours);
  return { hour, wake: Math.max(4, rise - 1.2 + habit(b.id, 1) * 0.8), bed: 20.8 + habit(b.id, 2) * 1.6, dark: sunNow(world) < 0.06 };
}

/** What is going on inside a building now. */
export function hearthOf(world: World, b: Building): Hearth {
  if (b.status !== 'done' || b.demolition) return NONE;
  const { hour, dark } = hours(world, b);
  const allNight = b.type === 'tavern' || b.type === 'chapel' || b.type === 'watchtower';
  const lantern = dark && (allNight || hour > 12 || hour < 1) ? 1 : 0;
  return { ...inside(world, b), lantern };
}

/** What burns and shines inside (hearthOf, without the lantern). */
function inside(world: World, b: Building): Omit<Hearth, 'lantern'> {
  const { hour, wake, bed, dark } = hours(world, b);
  const awake = hour >= wake && hour < bed;
  const meal = (hour >= wake && hour < wake + 1.4) || (hour >= 11.2 && hour < 13) || hour >= bed - 3.2;

  switch (b.type) {
    case 'house': {
      // always someone at home
      const hearth = !awake ? 0 : meal ? 1 : 0.3;
      return { hearth, furnace: 0, light: awake && dark ? 1 : 0, shutters: awake ? 1 : 0, asleep: awake ? 0 : 1 };
    }
    case 'tavern': {
      const open = hour >= 6.5 && hour < 23.6;
      return { hearth: open ? 1 : 0.25, furnace: 0, light: open && dark ? 1 : 0, shutters: open ? 1 : 0, asleep: 0 };
    }
    case 'chapel':
      return { hearth: 0, furnace: 0, light: dark && (hour > 15 || hour < 1) ? 0.75 : 0, shutters: 1, asleep: 0 };
    case 'blacksmith': {
      // the forge burns through the working day
      const forge = isWorkTime(world) ? 1 : hour > 4 && hour < 22 && !dark ? 0.35 : 0;
      return { hearth: 0, furnace: forge, light: dark ? forge * 0.6 : 0, shutters: 1, asleep: 0 };
    }
    case 'watchtower': {
      // the watch keeps a brazier burning through the night
      const night = dark ? 1 : 0;
      return { hearth: 0, furnace: night, light: night, shutters: 1, asleep: 0 };
    }
    case 'warehouse':
    case 'market':
    case 'well':
    case 'intersection':
      return { ...NONE };
    default:
      return workplace(world, b, { hour, wake, bed, dark, meal });
  }
}

/** A building its workers live in: what they're doing says what burns. */
function workplace(world: World, b: Building, t: { hour: number; wake: number; bed: number; dark: boolean; meal: boolean }): Omit<Hearth, 'lantern'> {
  const crew = employees(world, b).map((p) => p.job!.worker);
  const residents = Object.keys(BUILDINGS[b.type].jobs).length > 0;
  if (!crew.length) return { ...NONE, shutters: residents ? 0 : 1 };
  let home = 0;
  let asleep = 0;
  let awakeHome = 0;
  let lunch = 0;
  let indoors = 0;
  for (const w of crew) {
    const task = w.task;
    if (task.kind === 'home') {
      home++;
      if (task.activity === 'lunch') {
        lunch++;
        awakeHome++;
      } else if (t.hour >= t.wake && t.hour < t.bed) awakeHome++;
      else asleep++;
    } else if ((task.kind === 'job' && task.indoors) || task.kind === 'enter' || task.kind === 'exit') indoors++;
  }
  // the hearth: lit for meals and evenings by whoever is home, banked while they're out at work
  const hearth = lunch ? 1 : awakeHome ? (t.meal ? 1 : 0.6) : home ? 0 : 0.15;
  const light = t.dark && (awakeHome || indoors) ? 1 : 0;
  // the oven: hot while the baker bakes, kept warm through the day
  let furnace = 0;
  if (b.type === 'bakery') {
    const baking = crew.some((w) => w.task.kind === 'job' && w.task.carried && !w.task.indoors);
    furnace = baking ? 1 : isWorkTime(world) ? 0.45 : 0;
  }
  return { hearth: b.type === 'mill' ? 0 : hearth, furnace, light, shutters: asleep && !awakeHome ? 0 : 1, asleep };
}
