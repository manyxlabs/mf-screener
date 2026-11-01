import { getColumns } from "@/lib/api";
import { GlossaryClient } from "./glossary-client";

/**
 * The plain-language door into the vocabulary. `/methodology` stays the canonical
 * statement of how each number is computed, formulas and all; this page answers the
 * prior question of what a number is and how to read it, and links there for the rest.
 *
 * The metric entries are generated from the same catalogue the screener's column
 * headers use, so a metric can never exist in the table and be missing here.
 */
export default async function GlossaryPage() {
  const columns = await getColumns();
  return <GlossaryClient metrics={columns.metrics} />;
}
