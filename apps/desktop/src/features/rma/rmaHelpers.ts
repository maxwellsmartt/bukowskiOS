import type { RmaCaseDetailSnapshot, RmaCaseStatus } from "@contracts";

export const resolveRmaStatusTone = (status: RmaCaseStatus) => {
  if (status === "Repaired" || status === "Returned to inventory") {
    return "success" as const;
  }

  if (status === "Sent to repair" || status === "Waiting parts") {
    return "info" as const;
  }

  if (status === "No repair / retired") {
    return "critical" as const;
  }

  return "warning" as const;
};

export const rmaStatusActions: Array<{ status: RmaCaseStatus; label: string }> = [
  { status: "Sent to repair", label: "Send to repair" },
  { status: "Waiting parts", label: "Waiting parts" },
  { status: "Repaired", label: "Mark repaired" },
  { status: "No repair / retired", label: "No repair" },
  { status: "Returned to inventory", label: "Return to inventory" },
];

export const buildRmaMailtoUrl = (detail: RmaCaseDetailSnapshot) => {
  if (!detail.caseRecord) {
    return "";
  }

  const subject = detail.caseRecord.title;
  const lines = [
    `Hello ${detail.caseRecord.contactName || detail.caseRecord.manufacturerName} team,`,
    "",
    detail.caseRecord.problemSummary,
    "",
    "Assets included:",
    ...detail.assets.map(
      (asset, index) =>
        `${index + 1}. ${asset.assetName} | ${[asset.brand, asset.model].filter(Boolean).join(" ")} | Serial: ${asset.serialNumber || "Pending"} | Year: ${asset.equipmentYear || "Pending"} | Issue: ${asset.issueSummary}`,
    ),
    "",
    detail.caseRecord.notes ? `Internal notes / context:\n${detail.caseRecord.notes}\n` : "",
    "Please confirm next steps and support instructions.",
  ].filter(Boolean);

  const recipient = detail.caseRecord.supportEmail ?? "";
  return `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
};
