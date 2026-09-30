// Persistence: keeps the game in the browser's IndexedDB so a reload continues
// where the player left off. The save format itself (what is saved, versions,
// validation) is pure game logic in src/game/save.ts; this file only stores it
// and decides when to write.
//
// Writes happen every half hour of game time (so a faster clock saves more
// often), soon after something is built, and when the page is hidden or
// closed. A save holds everything about every character: where they are,
// where they are going and why, and what they carry (see game/save.ts). If IndexedDB is unavailable (e.g. some
// private windows) the game still runs, it just starts fresh on every load.

import { GAME_HOUR } from '../game/daynight';
import { loadWorld, saveWorld, type SaveData } from '../game/save';
import { createWorld, type World } from '../game/world';

const DB_NAME = 'village-game';
const DB_VERSION = 1;
const STORE = 'saves';
/** The one save slot for now; more slots would be more keys in the same store. */
const SLOT = 'autosave';
/** Autosave every this many game hours. */
const AUTOSAVE_HOURS = 0.5;

export interface SaveStore {
  read(): Promise<unknown>;
  write(data: SaveData): Promise<void>;
  clear(): Promise<void>;
  /** Keep a save we could not load under its own key, so autosave can't destroy it. */
  stash(data: unknown): Promise<void>;
}

const done = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** Open the save database; null if the browser won't give us one. */
export async function openSaveStore(): Promise<SaveStore | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
    };
    const db = await done(open);
    const store = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
    return {
      read: () => done(store('readonly').get(SLOT)),
      write: async (data) => void (await done(store('readwrite').put(data, SLOT))),
      clear: async () => void (await done(store('readwrite').delete(SLOT))),
      stash: async (data) => void (await done(store('readwrite').put(data, `unloadable-${Date.now()}`))),
    };
  } catch (e) {
    console.warn('Saving disabled: IndexedDB unavailable', e);
    return null;
  }
}

/** The saved world, or a new village if there is no usable save. */
export async function loadGame(store: SaveStore | null): Promise<{ world: World; restored: boolean }> {
  const data = await store?.read().catch((e) => console.warn('Could not read the save', e));
  if (data !== undefined) {
    const r = loadWorld(data);
    if (r.ok) return { world: r.world, restored: true };
    console.warn(`Save not loaded (${r.error}); kept it aside and started a new village`, data);
    await store?.stash(data).catch((e) => console.warn('Could not keep the unloadable save', e));
  }
  return { world: createWorld(), restored: false };
}

export interface Autosave {
  /** Call every frame: saves when another half hour of game time has passed. */
  tick(): void;
  /** Save shortly (e.g. after the player built something). */
  requestSave(): void;
  /** Wipe the save and reload into a fresh village. */
  newGame(): Promise<void>;
}

export function installAutosave(world: World, store: SaveStore | null): Autosave {
  let writing = false;
  let again = false;
  let stopped = false;

  async function save(): Promise<void> {
    if (!store || stopped) return;
    if (writing) {
      again = true; // coalesce: one more write once this one lands
      return;
    }
    writing = true;
    try {
      await store.write(saveWorld(world));
    } catch (e) {
      console.warn('Autosave failed', e);
    } finally {
      writing = false;
    }
    if (again) {
      again = false;
      void save();
    }
  }

  let soon: number | undefined;
  const slot = () => Math.floor(world.dayClock / (GAME_HOUR * AUTOSAVE_HOURS));
  let lastSlot = slot();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void save();
  });
  window.addEventListener('pagehide', () => void save());

  return {
    tick() {
      const now = slot();
      if (now === lastSlot) return;
      lastSlot = now;
      void save();
    },
    requestSave() {
      window.clearTimeout(soon);
      soon = window.setTimeout(() => void save(), 300);
    },
    async newGame() {
      stopped = true; // no save may land between the wipe and the reload
      await store?.clear().catch((e) => console.warn('Could not clear the save', e));
      window.location.reload();
    },
  };
}
