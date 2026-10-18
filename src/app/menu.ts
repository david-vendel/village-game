// The Menu: the HUD's Menu button (render/ui.ts) opens this dropdown under it.
// It switches buildings between 2D art and 3D, and opens and closes the side
// panels (panel.ts menuPanels: versions, tuning, workers). A click anywhere
// else, or Esc, closes it.

import { menuPanels } from './panel';

/** Something the Menu switches on and off. */
export interface MenuToggle {
  title: string;
  isOn(): boolean;
  toggle(): void;
}

export interface Menu {
  /** Open it below `at` (CSS px: the button's bottom right corner), or close it if open. */
  toggle(at: { right: number; top: number }): void;
  isOpen(): boolean;
}

export function installMenu(toggles: () => MenuToggle[]): Menu {
  const root = document.createElement('div');
  root.style.cssText =
    'position:fixed;z-index:20;display:none;min-width:150px;color:#f3ead8;' +
    'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;' +
    'background:rgba(20,14,8,0.92);border:1px solid rgba(232,200,114,0.35);' +
    'border-radius:8px;padding:6px;user-select:none';
  document.body.appendChild(root);
  // the click that opened it must not close it again on its way up to the document
  let justToggled = false;

  const rows = (): MenuToggle[] => [...toggles(), ...menuPanels.map((p) => ({ title: p.title, isOn: p.isOpen, toggle: () => p.setOpen(!p.isOpen()) }))];

  const render = () => {
    root.replaceChildren();
    for (const t of rows()) {
      const b = document.createElement('button');
      const on = t.isOn();
      b.style.cssText =
        'display:flex;justify-content:space-between;gap:16px;width:100%;text-align:left;font:inherit;cursor:pointer;' +
        'margin:1px 0;padding:3px 8px;border-radius:4px;border:none;color:#f3ead8;background:none';
      b.innerHTML = `<span>${t.title}</span><span style="color:#e8c872;opacity:${on ? 1 : 0.35}">${on ? '●' : '○'}</span>`;
      b.addEventListener('mouseenter', () => (b.style.background = 'rgba(232,200,114,0.12)'));
      b.addEventListener('mouseleave', () => (b.style.background = 'none'));
      b.addEventListener('click', () => {
        t.toggle();
        b.blur(); // hand the keys back to the game
        render();
      });
      root.append(b);
    }
  };

  const close = () => {
    root.style.display = 'none';
  };

  document.addEventListener('pointerdown', (e) => {
    if (justToggled) justToggled = false;
    else if (!root.contains(e.target as Node)) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  return {
    toggle(at) {
      justToggled = true;
      if (root.style.display !== 'none') return close();
      render();
      Object.assign(root.style, { display: 'block', right: `${at.right}px`, top: `${at.top}px` });
    },
    isOpen: () => root.style.display !== 'none',
  };
}
