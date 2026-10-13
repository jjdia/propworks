// Bumped on every deploy so the version is visible INSIDE the running app
// (header and login), not just in the zip filename. Keep this in sync with
// the zip filename. Header/login show APP_VERSION only — no feature notes.
// APP_VERSION_DETAIL is admin-only.
export const APP_VERSION = 'V 32';
export const APP_VERSION_DETAIL =
  '#14 Fill lease from PDF (pdf.js / on-device OCR) + scan receipt/bill into expense; suggestions only';
