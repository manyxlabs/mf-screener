// Kept out of the "use client" toggle: a server layout importing a string from a client
// module gets a client reference, which renders as a stub function instead of the script.

/** The portfolio's key and mechanism: "dark" or "light" in `theme`, the `dark` class on <html>. */
export const THEME_KEY = "theme";
/** Where the screener kept the choice before it took the portfolio's key; still honoured. */
const LEGACY_THEME_KEY = "mf-theme";

/**
 * Runs before the first paint, from a blocking inline script, so the page never renders
 * light and then flips. It is inlined as a string because a React effect runs too late.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)})||localStorage.getItem(${JSON.stringify(LEGACY_THEME_KEY)})}catch(e){}if(t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches)document.documentElement.classList.add("dark")})()`;
