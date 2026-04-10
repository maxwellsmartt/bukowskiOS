export const projectColorPalette = [
  { key: "ice", label: "Ice" },
  { key: "steel", label: "Steel" },
  { key: "teal", label: "Teal" },
  { key: "moss", label: "Moss" },
  { key: "amber", label: "Amber" },
  { key: "coral", label: "Coral" },
  { key: "rose", label: "Rose" },
  { key: "copper", label: "Copper" },
  { key: "violet", label: "Violet" },
  { key: "slate", label: "Slate" },
] as const;

export type ProjectColorKey = (typeof projectColorPalette)[number]["key"];
