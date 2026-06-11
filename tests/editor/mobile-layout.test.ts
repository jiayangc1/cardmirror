/**
 * Mobile-shell activation rules — the boot-time decision between the
 * desktop UI and the view-first mobile shell. Resolved once per load;
 * native hosts never get the mobile shell regardless of the setting.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveMobileLayout,
  mobileDensity,
  MOBILE_AUTO_MAX_WIDTH,
} from '../../src/editor/mobile-layout.js';

const phone = { hostKind: 'browser', coarsePointer: true, viewportWidth: 390 };
const tabletLandscape = { hostKind: 'browser', coarsePointer: true, viewportWidth: 1180 };
const laptop = { hostKind: 'browser', coarsePointer: false, viewportWidth: 1440 };

describe('resolveMobileLayout', () => {
  it('auto picks mobile on a small coarse-pointer browser screen', () => {
    expect(resolveMobileLayout('auto', phone)).toBe(true);
  });

  it('auto keeps desktop on fine pointers and on wide touch screens', () => {
    expect(resolveMobileLayout('auto', laptop)).toBe(false);
    expect(resolveMobileLayout('auto', tabletLandscape)).toBe(false);
    // Boundary: exactly the cutoff width stays desktop.
    expect(
      resolveMobileLayout('auto', { ...phone, viewportWidth: MOBILE_AUTO_MAX_WIDTH }),
    ).toBe(false);
  });

  it('explicit mobile / desktop override the heuristics', () => {
    expect(resolveMobileLayout('mobile', laptop)).toBe(true);
    expect(resolveMobileLayout('desktop', phone)).toBe(false);
  });

  it('native hosts always get the desktop UI', () => {
    expect(resolveMobileLayout('mobile', { ...phone, hostKind: 'electron' })).toBe(false);
    expect(resolveMobileLayout('auto', { ...phone, hostKind: 'tauri' })).toBe(false);
  });
});

describe('mobileDensity', () => {
  it('splits phone vs tablet at 768px', () => {
    expect(mobileDensity(390)).toBe('phone');
    expect(mobileDensity(767)).toBe('phone');
    expect(mobileDensity(768)).toBe('tablet');
    expect(mobileDensity(1024)).toBe('tablet');
  });
});
