// Advanced graphics: the work in progress on the game's look (3D buildings and
// their styles, the showroom of art tests, building numbers), behind one Menu
// switch, "Advanced graphics", off by default. Off, the game is the base game
// with its 2D art, which is what game-mechanics work is done and tested with.
//
// Everything the switch governs is set up here, so the base game's files
// (controls.ts, main.ts) only call into this module: work on graphics changes
// this file and the render side's 3D files (render/scene3d.ts and what it
// uses), not theirs. See CLAUDE.md, "Graphics and mechanics".

import { DEFAULT_STYLE_3D, setShowroom, setStyle3d, STYLES_3D } from '../render';
import type { MenuToggle } from './menu';

const ADVANCED_KEY = 'village-game:advanced-graphics';
const VIEW3D_KEY = 'village-game:view3d';
const STYLE_KEY = 'village-game:style3d';
const SHOWROOM_KEY = 'village-game:showroom';

const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // no storage: it just won't be remembered
  }
};

export interface Graphics {
  /** The Menu's rows: the switch, and with it on, what it governs. */
  menuItems(): MenuToggle[];
  /** Buildings drawn in real-time 3D (advanced graphics on, and 3D chosen). */
  view3d(): boolean;
}

/**
 * Preferences the browser keeps; the address can set them for a link: ?gfx=1 / 0 (advanced
 * graphics), ?3d=1 / 0, ?style=<name>, ?showroom=1 / 0. V switches 2D / 3D while it is on.
 */
export function installGraphics(): Graphics {
  const q = new URLSearchParams(location.search);
  const flag = (param: string, key: string, on: string, def: boolean) => {
    const p = q.get(param);
    return p === '1' ? true : p === '0' ? false : (stored(key) ?? (def ? on : '')) === on;
  };
  let advanced = flag('gfx', ADVANCED_KEY, '1', false);
  let view3d = flag('3d', VIEW3D_KEY, '3d', true);
  // the showroom of art experiments along the main street (render/showroom.ts): dev builds only
  let showroom = import.meta.env.DEV && flag('showroom', SHOWROOM_KEY, '1', true);
  const styleParam = q.get('style');
  let style = styleParam && STYLES_3D[styleParam] ? styleParam : (stored(STYLE_KEY) ?? DEFAULT_STYLE_3D);
  if (!STYLES_3D[style]) style = DEFAULT_STYLE_3D;
  setStyle3d(style);

  const apply = () => setShowroom(advanced && showroom);
  apply();
  const toggleView3d = () => {
    view3d = !view3d;
    store(VIEW3D_KEY, view3d ? '3d' : '2d');
  };
  window.addEventListener('keydown', (e) => {
    if (advanced && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'v') toggleView3d();
  });

  const items: MenuToggle[] = [
    { title: '  3D buildings', isOn: () => view3d, toggle: toggleView3d },
    ...Object.values(STYLES_3D).map((s) => ({
      title: `    ${s.label}`,
      isOn: () => view3d && style === s.name,
      toggle: () => {
        style = s.name;
        setStyle3d(style);
        store(STYLE_KEY, style);
        if (!view3d) toggleView3d();
      },
    })),
    ...(import.meta.env.DEV
      ? [
          {
            title: '  Showroom (art tests)',
            isOn: () => showroom,
            toggle: () => {
              showroom = !showroom;
              store(SHOWROOM_KEY, showroom ? '1' : '0');
              apply();
            },
          },
        ]
      : []),
  ];
  const master: MenuToggle = {
    title: 'Advanced graphics',
    isOn: () => advanced,
    toggle: () => {
      advanced = !advanced;
      store(ADVANCED_KEY, advanced ? '1' : '0');
      apply();
    },
  };
  return {
    menuItems: () => (advanced ? [master, ...items] : [master]),
    view3d: () => advanced && view3d,
  };
}
