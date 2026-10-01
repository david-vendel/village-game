import { describe, expect, it } from 'vitest';
import { VIEW_H } from '../game/layout';
import { computeViewport, defaultZoom, zoomRange, ZOOM_MAX } from './viewport';

describe('viewport', () => {
  it('landscape desktop starts at zoom 1 with the ground at the bottom', () => {
    const v = computeViewport(1920, 1080, defaultZoom(1920, 1080));
    expect(v.zoom).toBe(1);
    expect(v.top).toBeCloseTo(0);
    expect(v.viewW).toBeCloseTo(1920 / (1080 / VIEW_H));
  });

  it('zooming out shows more street and sky', () => {
    const v1 = computeViewport(1920, 1080, 1);
    const v = computeViewport(1920, 1080, 0.5);
    expect(v.viewW).toBeCloseTo(v1.viewW * 2);
    expect(v.top).toBeCloseTo(-VIEW_H);
    // the bottom of the scene still maps to the canvas bottom
    expect(VIEW_H * v.worldScale + v.offsetY).toBeCloseTo(1080);
  });

  it('portrait phone starts zoomed out and can zoom further out', () => {
    const [cw, ch] = [1170, 2532];
    const z = defaultZoom(cw, ch);
    expect(z).toBeLessThan(0.7);
    expect(computeViewport(cw, ch, z).viewW).toBeCloseTo(460);
    expect(zoomRange(cw, ch)[0]).toBeLessThan(z);
  });

  it('portrait touch screens lift the scene above the buttons', () => {
    const [cw, ch] = [1170, 2532];
    const v = computeViewport(cw, ch, defaultZoom(cw, ch, true), true);
    const sceneBottomPx = VIEW_H * v.worldScale + v.offsetY;
    expect(ch - sceneBottomPx).toBeCloseTo(118 * v.uiScale);
    expect(v.bottom).toBeGreaterThan(VIEW_H);
    // landscape touch keeps the scene at the bottom
    const l = computeViewport(2532, 1170, 1, true);
    expect(VIEW_H * l.worldScale + l.offsetY).toBeCloseTo(1170);
  });

  it('zoom is clamped and UI keeps a minimum size', () => {
    const v = computeViewport(1170, 2532, 99);
    expect(v.zoom).toBe(ZOOM_MAX);
    expect(v.uiW).toBeGreaterThanOrEqual(440);
    expect(computeViewport(1920, 1080, 0.01).zoom).toBe(0.45);
    expect(computeViewport(1920, 1080, 1).uiH).toBeCloseTo(540);
  });
});
