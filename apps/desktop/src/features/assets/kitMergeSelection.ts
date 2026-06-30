export type KitAssetSelection = { assetId: string; quantity: number };

/**
 * Merge newly-selected assets into a kit's existing member list.
 *
 * The backend kit update REPLACES kit_assets wholesale (`replaceKitAssets`), so
 * "add assets to an existing kit" must resend the FULL membership or existing
 * members are silently dropped. This helper unions the kit's current selections
 * with the newly chosen ones: existing members keep their quantity, brand-new
 * assets are appended (quantity clamped to >= 1), and the result is deduped by
 * assetId preserving existing-first order.
 */
export const mergeKitAssetSelections = (
  existing: KitAssetSelection[],
  added: KitAssetSelection[],
): KitAssetSelection[] => {
  const byAssetId = new Map<string, KitAssetSelection>();

  for (const selection of existing) {
    byAssetId.set(selection.assetId, { assetId: selection.assetId, quantity: Math.max(1, selection.quantity) });
  }

  for (const selection of added) {
    if (!byAssetId.has(selection.assetId)) {
      byAssetId.set(selection.assetId, { assetId: selection.assetId, quantity: Math.max(1, selection.quantity) });
    }
  }

  return Array.from(byAssetId.values());
};
