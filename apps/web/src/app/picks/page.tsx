import { getColumns, getPresets, getScreen } from "@/lib/api";
import { toQueryString, presetToFilters, DEFAULT_FILTERS } from "@/lib/screen-query";
import { PicksClient } from "./picks-client";

export const dynamic = "force-dynamic";

// Enough to choose from without turning a sleeve back into the full screener.
const CANDIDATES_PER_SLOT = 8;

export default async function PicksPage() {
  const [columns, presets] = await Promise.all([getColumns(), getPresets()]);
  const slots = presets.filter((preset) => preset.slot);

  const screens = await Promise.all(
    slots.map((preset) =>
      getScreen(
        toQueryString({
          ...presetToFilters(preset, DEFAULT_FILTERS),
          pageSize: CANDIDATES_PER_SLOT,
          columns: preset.columns,
        }),
      ),
    ),
  );

  return (
    <PicksClient
      slots={slots.map((preset, index) => ({ preset, screen: screens[index]! }))}
      columnsMeta={columns}
    />
  );
}
