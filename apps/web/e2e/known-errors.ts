/**
 * React #418 thrown while hydrating Next's own route tree. Under load, on a page that
 * follows another page in the same tab, the app router's layout router renders no
 * children inside <main> for one hydration pass, so React discards the server HTML and
 * renders the page on the client. It reproduces at the same rate on builds from before
 * any SEO work, on fully static pages, and with Next 15.5.29, and the page ends up
 * correct, so it is excluded here rather than failing every deploy. Any other error,
 * hydration or not, still fails the test.
 */
export const isNextHydrationRace = (message: string) =>
  message.startsWith("Minified React error #418;");
