export type RenderFidelityAuditItem = {
  id: string;
  label: string;
  currentKind: "raster" | "vector" | "css";
  recommendedKind: "raster" | "vector" | "css";
  rationale: string;
};

export const renderFidelityAudit: RenderFidelityAuditItem[] = [
  {
    id: "brand-shell-lockup",
    label: "Shell brand lockup",
    currentKind: "raster",
    recommendedKind: "vector",
    rationale: "Logo principal usado en superficie core; si existe master aprobado conviene migrarlo a SVG.",
  },
  {
    id: "provider-openclaw-logo",
    label: "OpenClaw provider logo",
    currentKind: "raster",
    recommendedKind: "vector",
    rationale: "Se usa en pills y headings pequeños; el vector evitaría blur en densidades altas.",
  },
  {
    id: "scannable-previews",
    label: "QR / barcode previews",
    currentKind: "raster",
    recommendedKind: "raster",
    rationale: "Se generan como bitmap y hoy siguen encajando mejor en pipeline raster multiescala.",
  },
  {
    id: "document-thumbnails",
    label: "Document thumbnails",
    currentKind: "raster",
    recommendedKind: "raster",
    rationale: "Son previews de archivos e imágenes; deben seguir como raster.",
  },
];

export const getRenderFidelityAuditSummary = () => {
  const vectorCandidates = renderFidelityAudit.filter((item) => item.recommendedKind === "vector").length;
  const rasterItems = renderFidelityAudit.filter((item) => item.recommendedKind === "raster").length;

  return {
    vectorCandidates,
    rasterItems,
    total: renderFidelityAudit.length,
  };
};
