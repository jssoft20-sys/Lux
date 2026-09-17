/** Short vibration on supported devices (Android Chrome); silently ignored elsewhere. */
export function haptic(pattern: number | number[] = 8) {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}
export const hapticSuccess = () => haptic([10, 40, 18]);
export const hapticError = () => haptic([30, 30, 30]);
