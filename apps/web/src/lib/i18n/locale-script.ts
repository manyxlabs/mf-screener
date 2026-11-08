import { DEFAULT_LOCALE, LOCALES, SINGLE_URL_PREFIX } from "./locales";

// Kept out of the "use client" provider: a server layout importing a string from a client
// module gets a client reference, which renders as a stub function instead of the script.

export const LOCALE_KEY = "mf-lang";

/**
 * Runs before first paint on a single-URL page whose reader prefers another language,
 * and hides the English render until the translation replaces it. The CSS that hides it
 * also reveals the page after a few seconds, so a failed chunk never leaves it blank.
 */
export const LOCALE_INIT_SCRIPT = `(function(){try{if(!location.pathname.startsWith(${JSON.stringify(SINGLE_URL_PREFIX)}))return;var s=${JSON.stringify(
  LOCALES,
)},l=localStorage.getItem(${JSON.stringify(LOCALE_KEY)});if(s.indexOf(l)<0){l=null;for(var i=0;i<navigator.languages.length&&!l;i++){var p=navigator.languages[i].split("-")[0].toLowerCase();if(s.indexOf(p)>=0)l=p}}if(l&&l!==${JSON.stringify(
  DEFAULT_LOCALE,
)})document.documentElement.dataset.localePending=""}catch(e){}})()`;
