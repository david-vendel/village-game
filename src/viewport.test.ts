import { describe, expect, it } from 'vitest';
import { computeViewport, defaultZoom, zoomRange } from './viewport';

describe('viewport', () => {
  it('landscape desktop starts at zoom 1 with the ground at the bottom', () => {
    const v = computeViewport(1920, 1080, defaultZoom(1920, 1080));
    expect(v.zoom).toBe(1);
    expect(v.top).toBeCloseTo(0);
    expect(v.viewW).toBeCloseTo(960);
  });

  it('zooming out shows more street and sky', () => {
    const v = computeViewport(1920, 1080, 0.5);
    expect(v.viewW).toBeCloseTo(1920);
    expect(v.top).toBeCloseTo(-540);
    // ground line (world y 540) still maps to the canvas bottom
    expect(540 * v.worldScale + v.offsetY).toBeCloseTo(1080);
  });

  it('portrait phone starts zoomed out and can zoom further out', () => {
    const [cw, ch] = [1170, 2532];
    const z = defaultZoom(cw, ch);
    expect(z).toBeLessThan(0.6);
    expect(computeViewport(cw, ch, z).viewW).toBeCloseTo(460);
    expect(zoomRange(cw, ch)[0]).toBeLessThan(z);
  });

  it('portrait touch screens lift the street above the buttons', () => {
    const [cw, ch] = [1170, 2532];
    const v = computeViewport(cw, ch, defaultZoom(cw, ch, true), true);
    const streetBottomPx = 540 * v.worldScale + v.offsetY;
    expect(ch - streetBottomPx).toBeCloseTo(118 * v.uiScale);
    expect(v.bottom).toBeGreaterThan(540);
    // landscape touch keeps the street at the bottom
    const l = computeViewport(2532, 1170, 1, true);
    expect(540 * l.worldScale + l.offsetY).toBeCloseTo(1170);
  });

  it('zoom is clamped and UI keeps a minimum width', () => {
    const v = computeViewport(1170, 2532, 99);
    expect(v.zoom).toBe(1);
    expect(v.uiW).toBeGreaterThanOrEqual(440);
    expect(computeViewport(1920, 1080, 0.01).zoom).toBe(0.45);
  });
});
