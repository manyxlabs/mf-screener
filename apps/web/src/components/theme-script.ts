// Kept out of the "use client" toggle: a server layout importing a string from a client
// module gets a client reference, which renders as a stub function instead of the script.

export const THEME_KEY = "mf-theme";

/**
 * Runs before the first paint, from a blocking inline script, so the page never renders
 * light and then flips. It is inlined as a string because a React effect runs too late.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});if(!t)t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}})()`;
