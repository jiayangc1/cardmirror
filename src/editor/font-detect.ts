/**
 * Detect which named fonts are actually installed on the user's system.
 *
 * The trick: render a fixed test string in the candidate font with each
 * of the three CSS generic fallbacks (monospace / serif / sans-serif).
 * If the candidate isn't installed, the browser falls back to the
 * generic and the rendered metrics match the bare generic's metrics.
 * If the candidate IS installed, at least one base's measurement
 * differs.
 *
 * Not perfect — a font with the same metrics as one of the bases would
 * be misclassified — but reliable for the body fonts we care about
 * here.
 *
 * Generic CSS keywords (serif, sans-serif, monospace, ...) are always
 * available; skip detection for them.
 */

const GENERIC_KEYWORDS = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
]);

const TEST_STRING = 'mmmmmmmmmmlli';
const TEST_SIZE = '72px';
const BASE_FONTS = ['monospace', 'serif', 'sans-serif'] as const;

const cache = new Map<string, boolean>();

/**
 * Returns true if `font` resolves to a real installed font (i.e. not a
 * silent fallback to one of the generic categories). Generic keywords
 * are always considered available.
 */
export function isFontAvailable(font: string): boolean {
  if (GENERIC_KEYWORDS.has(font)) return true;
  if (typeof document === 'undefined') return false; // SSR / non-DOM
  const cached = cache.get(font);
  if (cached !== undefined) return cached;

  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.left = '-9999px';
  probe.style.top = '-9999px';
  probe.style.fontSize = TEST_SIZE;
  probe.textContent = TEST_STRING;
  document.body.appendChild(probe);

  // Baseline dimensions for each generic.
  const baseDimensions = new Map<string, { w: number; h: number }>();
  for (const base of BASE_FONTS) {
    probe.style.fontFamily = base;
    baseDimensions.set(base, {
      w: probe.offsetWidth,
      h: probe.offsetHeight,
    });
  }

  // If candidate differs from at least one base, it's installed.
  let detected = false;
  for (const base of BASE_FONTS) {
    probe.style.fontFamily = `"${font}", ${base}`;
    const baseDim = baseDimensions.get(base)!;
    if (probe.offsetWidth !== baseDim.w || probe.offsetHeight !== baseDim.h) {
      detected = true;
      break;
    }
  }

  document.body.removeChild(probe);
  cache.set(font, detected);
  return detected;
}
