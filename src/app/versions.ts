// The Versions panel: on the left edge, a list of the game as it was at each
// major graphics commit (versions.json), to go back and see how things were.
// ?v=<commit> opens that version: its build (public/versions/<commit>/, made
// by `npm run versions:build`) fills the window in a frame, with this panel
// over it to pick another or come back to the latest. Each old build keeps
// its own saves (the build script renames its databases), so today's village
// is never touched.

import { makeCollapsible } from './panel';
import list from './versions.json';

export interface Version {
  commit: string;
  date: string;
  title: string;
  note: string;
}

export const VERSIONS: Version[] = list;

/** The version the address asks for (?v=<commit>), if it is one of the list. */
export function requestedVersion(): Version | null {
  const v = new URLSearchParams(location.search).get('v');
  return VERSIONS.find((x) => v && (x.commit === v || x.commit.startsWith(v))) ?? null;
}

/** Open a version (null: the latest game), keeping the rest of the address. */
function open(v: Version | null): void {
  const u = new URL(location.href);
  if (v) u.searchParams.set('v', v.commit);
  else u.searchParams.delete('v');
  location.href = u.toString();
}

/** The Versions panel, bottom left; `current` is the version showing (null: the latest). */
export function installVersionsPanel(current: Version | null): void {
  const root = document.createElement('div');
  root.style.cssText =
    'position:fixed;left:12px;bottom:44px;z-index:10;max-height:70vh;overflow:auto;color:#f3ead8;' +
    'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;' +
    'background:rgba(20,14,8,0.85);border:1px solid rgba(232,200,114,0.25);' +
    'border-radius:8px;padding:8px 12px 10px;user-select:none;max-width:340px';
  const content = document.createElement('div');
  const head = document.createElement('div');
  head.textContent = 'versions';
  head.style.cssText = 'color:#e8c872;margin-bottom:4px';
  content.append(head);

  const row = (label: string, sub: string, active: boolean, onClick: () => void, title = '') => {
    const b = document.createElement('button');
    b.title = title;
    b.style.cssText =
      'display:block;width:100%;text-align:left;font:inherit;cursor:pointer;margin:1px 0;padding:1px 6px;border-radius:4px;white-space:nowrap;' +
      `color:${active ? '#1b1612' : '#f3ead8'};background:${active ? '#e8c872' : 'rgba(232,200,114,0.08)'};` +
      'border:1px solid rgba(232,200,114,0.3)';
    b.innerHTML = `${label} <span style="opacity:0.6;font-size:11px">${sub}</span>`;
    b.addEventListener('click', () => {
      b.blur();
      if (!active) onClick();
    });
    content.append(b);
  };
  row('Latest', 'now', current === null, () => open(null), 'The game as it is now');
  for (const v of [...VERSIONS].reverse()) row(v.title, v.commit, current?.commit === v.commit, () => open(v), `${v.date}: ${v.note}`);
  if (current) {
    const note = document.createElement('div');
    note.style.cssText = 'margin-top:6px;opacity:0.8;white-space:normal';
    note.textContent = `${current.title}: ${current.note} (keeps its own saves)`;
    content.append(note);
  }
  // starts folded: a list to open when wanted, not over the game. In the game it is opened from
  // the Menu; over an old version (no Menu) it keeps its own round button
  makeCollapsible(root, content, 'left', 'village-game:versions-open', false, current ? undefined : 'Versions');
  document.body.appendChild(root);
}

/** Show an old version instead of the game: its build in a frame filling the window, the panel over it. */
export function showVersion(v: Version): void {
  const canvas = document.getElementById('canvas');
  canvas?.remove();
  const frame = document.createElement('iframe');
  frame.src = `versions/${v.commit}/index.html`;
  frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:none;display:block';
  frame.title = `Village Crown at ${v.commit}`;
  // keys go to the game in the frame
  frame.addEventListener('load', () => frame.contentWindow?.focus());
  document.body.appendChild(frame);
  // a version that hasn't been built: say how to build it
  // (a dev server answers a missing page with the game's own: look for the build script's save renaming)
  fetch(frame.src)
    .then((r) => (r.ok ? r.text() : ''))
    .then((html) => {
      if (!html.includes(`'@${v.commit}'`)) throw new Error('missing');
    })
    .catch(() => {
      frame.remove();
      const msg = document.createElement('div');
      msg.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#f3ead8;font:16px Georgia,serif;background:#1b1612;text-align:center;padding:24px';
      msg.textContent = `This version (${v.commit}, ${v.title}) isn't built here. Run: npm run versions:build`;
      document.body.appendChild(msg);
    });
  installVersionsPanel(v);
}
