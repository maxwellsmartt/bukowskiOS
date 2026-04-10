import type { FinanceCostLinkRow, FinanceEntryRow, OverviewMetric } from "@contracts";

export const overviewMetrics: OverviewMetric[] = [
  { label: "Total assets", value: "428", tone: "neutral" },
  { label: "Assigned assets", value: "116", tone: "info" },
  { label: "Active incidents", value: "9", tone: "critical" },
  { label: "Open packing slips", value: "14", tone: "warning" },
  { label: "Maintenance watch", value: "12", tone: "success" },
];

export const recentMovements = [
  {
    asset: "SmallHD Cine 7",
    code: "MON-014",
    from: "Warehouse A",
    to: "Set / Cam B",
    actor: "Cam Dept",
    timestamp: "14:22",
  },
  {
    asset: "Aputure 600D",
    code: "LGT-022",
    from: "Set / Studio 3",
    to: "Warehouse A",
    actor: "Grip / Electric",
    timestamp: "13:08",
  },
  {
    asset: "Teradek Bolt 6 XT",
    code: "VID-008",
    from: "Warehouse A",
    to: "Project / Aurora",
    actor: "Video Assist",
    timestamp: "11:45",
  },
];

export const assets = [
  {
    id: "asset-smallhd-cine7",
    name: "SmallHD Cine 7",
    code: "MON-014",
    category: "Monitors",
    status: "Checked out",
    location: "Set / Cam B",
    project: "Aurora Campaign",
    responsible: "Paola Rivas",
    incidentsOpen: 1,
  },
  {
    id: "asset-aputure-600d",
    name: "Aputure 600D",
    code: "LGT-022",
    category: "Lighting",
    status: "Available",
    location: "Warehouse A",
    project: "—",
    responsible: "—",
    incidentsOpen: 0,
  },
  {
    id: "asset-teradek-bolt",
    name: "Teradek Bolt 6 XT",
    code: "VID-008",
    category: "Wireless Video",
    status: "Assigned",
    location: "Set / Video Village",
    project: "Aurora Campaign",
    responsible: "Luis Mena",
    incidentsOpen: 0,
  },
  {
    id: "asset-sachtler-flowtech",
    name: "Sachtler Flowtech 100",
    code: "SUP-010",
    category: "Support",
    status: "Maintenance",
    location: "Service Bench",
    project: "—",
    responsible: "Ops Repair",
    incidentsOpen: 1,
  },
];

export const assetTimeline = [
  {
    timestamp: "Today · 14:22",
    title: "Checked out to Cam B",
    body: "Assigned under Aurora Campaign with Paola Rivas as current responsible.",
  },
  {
    timestamp: "Today · 09:10",
    title: "Availability confirmed",
    body: "Ops reviewed condition and validated Warehouse A storage position.",
  },
  {
    timestamp: "Yesterday · 18:44",
    title: "Incident reported",
    body: "Minor scratch logged during prep. Cost estimate pending review.",
  },
];

export const packingSlips = [
  {
    number: "PS-1042",
    project: "Aurora Campaign",
    department: "Camera",
    responsible: "Paola Rivas",
    dueDate: "Apr 10",
    status: "Issued",
  },
  {
    number: "PS-1041",
    project: "Studio Sessions",
    department: "G&E",
    responsible: "Miguel Peralta",
    dueDate: "Apr 09",
    status: "Partial return",
  },
  {
    number: "PS-1039",
    project: "House Tests",
    department: "Video",
    responsible: "Luis Mena",
    dueDate: "Apr 08",
    status: "Overdue",
  },
];

export const incidents = [
  {
    title: "Cine 7 top plate scratch",
    asset: "MON-014",
    project: "Aurora Campaign",
    responsible: "Paola Rivas",
    severity: "Medium",
    costEstimate: "$120",
    status: "Open",
  },
  {
    title: "Flowtech latch not locking",
    asset: "SUP-010",
    project: "—",
    responsible: "Ops Repair",
    severity: "High",
    costEstimate: "$380",
    status: "In review",
  },
  {
    title: "Missing HDMI clamp",
    asset: "MON-014",
    project: "Aurora Campaign",
    responsible: "Camera Assist",
    severity: "Low",
    costEstimate: "Pending",
    status: "Open",
  },
];

export const projects = [
  {
    name: "Aurora Campaign",
    client: "Altura",
    status: "Active",
    departments: "Camera, G&E, Video",
    exposure: "$2,180",
  },
  {
    name: "Studio Sessions",
    client: "Metadata Internal",
    status: "Prep",
    departments: "G&E",
    exposure: "$680",
  },
  {
    name: "House Tests",
    client: "Internal",
    status: "Wrap",
    departments: "Video",
    exposure: "$320",
  },
];

export const financeMetrics: OverviewMetric[] = [
  { label: "Incident exposure", value: "$5,420", tone: "critical" },
  { label: "Replacement at risk", value: "$28,700", tone: "warning" },
  { label: "Maintenance queue", value: "12 assets", tone: "info" },
  { label: "Missing estimates", value: "3 incidents", tone: "neutral" },
];

export const financeExposureByProject = [
  { project: "Aurora Campaign", exposure: "$2,180", incidentCount: 3, assetsOut: "$11,400" },
  { project: "Studio Sessions", exposure: "$1,620", incidentCount: 2, assetsOut: "$8,700" },
  { project: "House Tests", exposure: "$920", incidentCount: 1, assetsOut: "$3,200" },
];

export const financeCostLinks: FinanceCostLinkRow[] = [
  {
    incident: "Cine 7 top plate scratch",
    asset: "MON-014",
    project: "Aurora Campaign",
    responsible: "Paola Rivas",
    severity: "Medium",
    costEstimate: "$120",
    replacementValue: "$2,299",
    financialStatus: "Estimate linked",
  },
  {
    incident: "Flowtech latch not locking",
    asset: "SUP-010",
    project: "Warehouse repair",
    responsible: "Ops Repair",
    severity: "High",
    costEstimate: "$380",
    replacementValue: "$1,799",
    financialStatus: "Needs approval",
  },
  {
    incident: "Missing HDMI clamp",
    asset: "MON-014",
    project: "Aurora Campaign",
    responsible: "Camera Assist",
    severity: "Low",
    costEstimate: "Pending",
    replacementValue: "$120",
    financialStatus: "Estimate missing",
  },
];

export const financeEntries: FinanceEntryRow[] = [
  {
    id: "entry-204",
    date: "2026-04-09",
    type: "Incident reserve",
    category: "Repair",
    reference: "INC-204",
    project: "Aurora Campaign",
    amount: "$120",
    status: "Draft",
  },
  {
    id: "entry-mon-014",
    date: "2026-04-08",
    type: "Replacement exposure",
    category: "Asset risk",
    reference: "MON-014",
    project: "Aurora Campaign",
    amount: "$2,299",
    status: "Linked",
  },
];
