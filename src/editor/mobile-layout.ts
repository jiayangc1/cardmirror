/**
 * Mobile-shell activation — the boot-time decision between the
 * desktop UI and the view-first mobile shell (SPEC-mobile-view.md).
 *
 * Resolved ONCE per page load, before either shell mounts; rotating
 * a tablet or resizing mid-session never thrashes the shell (same
 * reload-to-switch convention as the three-pane toggle). The mobile
 * shell is a web-edition feature: Electron always gets the desktop
 * UI regardless of the setting or screen.
 */

export type MobileLayoutSetting = 'auto' | 'mobile' | 'desktop';

export interface MobileLayoutEnv {
  /** `getHost().kind` — only `'browser'` is eligible; native hosts
   *  (electron, tauri) always get the desktop UI. */
  hostKind: string;
  /** `matchMedia('(pointer: coarse)').matches` at boot. */
  coarsePointer: boolean;
  /** `window.innerWidth` at boot (CSS px). */
  viewportWidth: number;
}

/** Width at/above which `auto` keeps the desktop layout even on a
 *  coarse pointer — large tablets in landscape are usable with the
 *  desktop UI, and its toggle is one tap away either way. */
export const MOBILE_AUTO_MAX_WIDTH = 1024;

export function resolveMobileLayout(
  setting: MobileLayoutSetting,
  env: MobileLayoutEnv,
): boolean {
  if (env.hostKind !== 'browser') return false;
  if (setting === 'desktop') return false;
  if (setting === 'mobile') return true;
  return env.coarsePointer && env.viewportWidth < MOBILE_AUTO_MAX_WIDTH;
}

/** Phone vs tablet density inside the mobile shell. One shell, two
 *  layout classes — `pmd-mobile-phone` overlays the outline drawer;
 *  `pmd-mobile-tablet` pins it as a persistent rail. */
export function mobileDensity(viewportWidth: number): 'phone' | 'tablet' {
  return viewportWidth >= 768 ? 'tablet' : 'phone';
}
