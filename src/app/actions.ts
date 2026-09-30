// Player actions: the verbs that keyboard and touch input both map onto.
// Each calls into the game and reports what happened as a short message.
// Messages are plain text here; how they look is up to the renderer.

import { BUILDING_TYPES, BUILDINGS } from '../game/buildings';
import { buildShortfall, upgradeShortfall } from '../game/economy';
import { RESOURCES, type Amounts } from '../game/resources';
import {
  canUpgrade,
  closeMenu,
  confirmMenu,
  crossroadAt,
  getBuilding,
  moveMenu,
  openMenu,
  plotAt,
  selectMenu,
  setConstructionEnabled,
  turnAtCrossroads,
  upgradeBuilding,
  type World,
} from '../game/world';
import type { Sound } from './sound';

export type Notify = (text: string) => void;

export interface Actions {
  toggleConstruction(): void;
  toggleSound(): void;
  openBuildMenu(): void;
  closeBuildMenu(): void;
  moveSelection(delta: number): void;
  select(index: number): void;
  build(): void;
  /** Whether the rider is at a crossroads, where ↑/↓ turn instead. */
  atCrossroads(): boolean;
  /** Turn onto the street crossing this one: up (away from the viewer) or down (towards them). */
  turn(way: 'up' | 'down'): void;
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
      // at a building that can be upgraded, the same key upgrades it
      const b = getBuilding(world, plotAt(world, world.rider.x)?.buildingId ?? null);
      const upgrade = b && BUILDINGS[b.type].upgrade;
      if (b && upgrade && canUpgrade(b)) {
        const lack = upgradeShortfall(world, b);
        if (Object.keys(lack).length) {
          sound.ui('denied');
          notify(`Not enough for a ${upgrade.name}: need ${needText(lack)}`);
          return;
        }
        upgradeBuilding(world, b);
        sound.ui('toggle');
        notify(b.upgraded ? `${upgrade.name} built` : `Upgrading the ${BUILDINGS[b.type].name} to a ${upgrade.name}`);
      } else if (isTouch()) {
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
    build() {
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
