import {
  BarChart3,
  Boxes,
  BriefcaseBusiness,
  Building2,
  ClipboardList,
  FolderCog,
  PackageSearch,
  ScrollText,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavItem = {
  label: string;
  path: string;
  icon?: LucideIcon;
};

export const primaryNav: NavItem[] = [
  { label: "Overview", path: "/overview", icon: BarChart3 },
  { label: "Assets", path: "/assets", icon: Boxes },
  { label: "Finance", path: "/finance", icon: BriefcaseBusiness },
];

export const assetsSubnav: NavItem[] = [
  { label: "Assets", path: "/assets", icon: PackageSearch },
  { label: "Packing Slips", path: "/packing-slips", icon: ScrollText },
  { label: "Incidents", path: "/incidents", icon: ClipboardList },
  { label: "Projects", path: "/projects", icon: Building2 },
  { label: "Catalog", path: "/catalog", icon: FolderCog },
];

export const financeSubnav: NavItem[] = [
  { label: "Overview", path: "/finance", icon: BarChart3 },
  { label: "Cost Links", path: "/finance/cost-links", icon: ClipboardList },
  { label: "Entries", path: "/finance/entries", icon: ScrollText },
];

export const utilityNav: NavItem[] = [{ label: "Settings", path: "/settings", icon: Settings }];
