// Self-hosted variable fonts (next/font/local) — no external font requests,
// no layout shift, and the build doesn't depend on Google Fonts being
// reachable.
//
// Archivo carries the "broadcast graphics" personality: a width axis lets us
// use it condensed-and-black for headers, badges, and the relegation line.
// Inter is the workhorse for body copy and data (great tabular numerals).
import localFont from "next/font/local";

export const display = localFont({
  src: "./fonts/archivo-var.woff2",
  variable: "--font-display",
  weight: "100 900",
  display: "swap",
});

// Sep 2026 redesign: Archivo carries the body copy too (regular width), so
// the whole site speaks with one family — condensed-and-black for headers,
// normal width for text and data. Inter stays on disk, unused.
export const body = localFont({
  src: "./fonts/archivo-var.woff2",
  variable: "--font-body",
  weight: "100 900",
  display: "swap",
});
