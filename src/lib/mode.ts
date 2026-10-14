/** The sample (demo) app lives under this path and runs on fake, in-browser data. */
export const SAMPLE_BASE = '/sample'

export const isSample =
  typeof window !== 'undefined' &&
  (window.location.pathname === SAMPLE_BASE || window.location.pathname.startsWith(SAMPLE_BASE + '/'))
