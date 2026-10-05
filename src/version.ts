// Bumped on every deploy so the version is visible INSIDE the running app
// (header and login), not just in the zip filename. Keep this in sync with
// the zip filename. Header/login show APP_VERSION only — no feature notes.
// APP_VERSION_DETAIL is admin-only.
export const APP_VERSION = 'V 26';
export const APP_VERSION_DETAIL =
  'path-based /admin routing · BrowserRouter basename · dashboard home link';
