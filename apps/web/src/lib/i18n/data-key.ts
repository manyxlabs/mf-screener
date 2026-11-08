// Import-free, so scripts/i18n-data-keys.mts can run it under plain Node.

// Pipeline text quotes live figures ("about 1,846 funds"), so the catalogue keys it with
// each number as a {n} slot: a nightly refresh changes the numbers, not the key.
export const NUMBER = /\d+(?:[.,]\d+)*/g;

/** The data catalogue's key for `text`: each number replaced by its {n} slot. */
export const dataKey = (text: string) => {
  let slot = 0;
  return text.replace(NUMBER, () => `{${slot++}}`);
};
