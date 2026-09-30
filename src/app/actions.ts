// Player actions: the verbs that keyboard and touch input both map onto.
// Each calls into the game and reports what happened as a short message.
// Messages are plain text here; how they look is up to the renderer.

import { BUILDING_TYPES, BUILDINGS } from '../game/buildings';
import { buildShortfall } from '../game/economy';
import { RESOURCES } from '../game/resources';
import {
  closeMenu,
  confirmMenu,
  getBuilding,
  moveMenu,
  openMenu,
  selectMenu,
  setConstructionEnabled,
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
      if (openMenu(world)) sound.ui('menuOpen');
      else if (isTouch()) {
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
    build() {
      if (!world.menu) return;
      // the menu stays open when the village can't pay, so another choice is one key away
      const type = BUILDING_TYPES[world.menu.selection];
      const lack = buildShortfall(world, type);
      if (Object.keys(lack).length) {
        sound.ui('denied');
        const need = RESOURCES.filter((r) => lack[r]).map((r) => `${lack[r]} more ${r}`).join(' and ');
        notify(`Not enough for a ${BUILDINGS[type].name}: need ${need}`);
        return;
      }
      const b = confirmMenu(world);
      if (!b) return;
      const name = BUILDINGS[b.type].name;
      notify(b.status === 'done' ? `${name} built` : `Construction of the ${name} begins`);
    },
  };
}

/** Turn game events from the last update into messages, and clear them. */
export function announceEvents(world: World, notify: Notify): void {
  for (const ev of world.events) {
    const b = getBuilding(world, ev.buildingId);
    if (ev.kind === 'completed' && b && world.constructionEnabled) notify(`The ${BUILDINGS[b.type].name} is complete!`);
  }
  world.events.length = 0;
}
