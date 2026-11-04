import { getCategories, getMetadata } from "./api";

export type CategoryPage = {
  slug: string;
  subCategory: string;
  category: string | null;
};

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * The sub-categories that get a page of their own, in AMFI's own naming. One with fewer
 * Direct Growth funds than a peer group needs would be a near-empty page.
 */
export async function categoryPages(): Promise<CategoryPage[]> {
  const [{ items }, metadata] = await Promise.all([getCategories(), getMetadata()]);
  const pages = items.flatMap((item) =>
    item.clean_sub_category &&
    item.direct_growth_active_count >= metadata.default_universe.min_peers
      ? [
          {
            slug: slugify(item.clean_sub_category),
            subCategory: item.clean_sub_category,
            category: item.clean_category,
          },
        ]
      : [],
  );
  const slugs = new Set(pages.map((page) => page.slug));
  if (slugs.size !== pages.length) throw new Error("Two sub-categories share a page slug");
  return pages;
}

export const categoryPath = (page: CategoryPage) => `/category/${page.slug}/`;

/** The sub-category's page, if it has one. */
export const categoryPageFor = async (subCategory: string | null) =>
  (await categoryPages()).find((page) => page.subCategory === subCategory);
