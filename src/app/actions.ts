// Player actions: the verbs that keyboard and touch input both map onto.
// Each calls into the game and reports what happened as a short message.
// Messages are plain text here; how they look is up to the renderer.

import { BUILDING_TYPES, BUILDINGS } from '../game/buildings';
import { buildShortfall, upgradeShortfall } from '../game/economy';
import { RESOURCES, type Amounts } from '../game/resources';
import {
  closeMenu,
  confirmMenu,
  crossroadAt,
  demolish,
  getBuilding,
  moveMenu,
  openMenu,
  selectMenu,
  setConstructionEnabled,
  turnAtCrossroads,
  turnToward,
  upgradeBuilding,
  type World,
} from '../game/world';
import type { Vec } from '../game/streets';
import type { Sound } from './sound';

export type Notify = (text: string) => void;

export interface Actions {
  toggleConstruction(): void;
  toggleSound(): void;
  /** The menu at the plot the rider is at: build on an empty plot; upgrade or pull down a building. */
  openBuildMenu(): void;
  closeBuildMenu(): void;
  moveSelection(delta: number): void;
  select(index: number): void;
  /** Do what is chosen in the open menu. */
  confirm(): void;
  /** Whether the rider is at a crossroads, where ↑/↓ turn instead. */
  atCrossroads(): boolean;
  /** Turn onto the street crossing this one: up (away from the viewer) or down (towards them). */
  turn(way: 'up' | 'down'): void;
  /** At a crossroads, turn onto the crossing street if it runs along map direction v (the view from above). */
  turnToward(v: Vec): void;
}

export function createActions(world: World, notify: Notify, isTouch: () => boolean, sound: Sound): Actions {
  return {
    toggleConstruction() {
      sound.ui('toggle');
      setConstructionEnabled(world, !world.constructionEnabled);
      notify(world.constructionEnabled ? 'Construction phase ON' : 'Construction phase OFF — buildings appear instantly');
    },
    toggleSound() {
      const muted = sound.toggleMute();
      if (!muted) sound.ui('toggle');
      notify(muted ? 'Sound off' : 'Sound on');
    },
    openBuildMenu() {
      if (openMenu(world)) {
        sound.ui('menuOpen');
        return;
      }
      if (isTouch()) {
        sound.ui('denied');
        notify('Ride to a pennant to build');
      }
    },
    closeBuildMenu() {
      closeMenu(world);
      sound.ui('menuClose');
    },
    moveSelection(delta) {
      moveMenu(world, delta);
      sound.ui('menuMove');
    },
    select(index) {
      selectMenu(world, index);
      sound.ui('menuMove');
    },
    atCrossroads() {
      return !world.menu && !!crossroadAt(world);
    },
    turn(way) {
      if (turnAtCrossroads(world, way)) sound.ui('menuMove');
    },
    turnToward(v) {
      if (turnToward(world, v)) sound.ui('menuMove');
    },
    confirm() {
      const menu = world.menu;
      if (menu?.kind === 'building') {
        const b = getBuilding(world, menu.buildingId);
        if (!b) return closeMenu(world);
        const name = BUILDINGS[b.type].name;
        if (menu.options[menu.selection] === 'demolish') {
          demolish(world, b);
          sound.ui('toggle');
          notify(world.constructionEnabled ? `Builders will pull the ${name} down` : `The ${name} is pulled down; serfs will carry off what is left`);
          return;
        }
        const upgrade = BUILDINGS[b.type].upgrade!;
        // the menu stays open when the village can't pay
        const lack = upgradeShortfall(world, b);
        if (Object.keys(lack).length) {
          sound.ui('denied');
          notify(`Not enough for a ${upgrade.name}: need ${needText(lack)}`);
          return;
        }
        closeMenu(world);
        upgradeBuilding(world, b);
        sound.ui('toggle');
        notify(b.upgraded ? `${upgrade.name} built` : `Upgrading the ${name} to a ${upgrade.name}`);
        return;
      }
      if (!world.menu) return;
      // the menu stays open when the village can't pay, so another choice is one key away
      const type = BUILDING_TYPES[world.menu.selection];
      const lack = buildShortfall(world, type);
      if (Object.keys(lack).length) {
        sound.ui('denied');
        notify(`Not enough for a ${BUILDINGS[type].name}: need ${needText(lack)}`);
        return;
      }
      const b = confirmMenu(world);
      if (!b) return;
      const name = BUILDINGS[b.type].name;
      notify(b.status === 'done' ? `${name} built` : `Construction of the ${name} begins`);
    },
  };
}

/** What is lacking, in words: "10 more wood and 5 more stone". */
function needText(lack: Amounts): string {
  return RESOURCES.filter((r) => lack[r]).map((r) => `${lack[r]} more ${r}`).join(' and ');
}

/** Turn game events from the last update into messages, and clear them. */
export function announceEvents(world: World, notify: Notify): void {
  for (const ev of world.events) {
    const b = getBuilding(world, ev.buildingId);
    if (ev.kind === 'completed' && b && world.constructionEnabled) notify(`The ${BUILDINGS[b.type].name} is complete!`);
    if (ev.kind === 'upgraded' && b && world.constructionEnabled) notify(`The ${BUILDINGS[b.type].upgrade?.name} is complete!`);
  }
  world.events.length = 0;
}
