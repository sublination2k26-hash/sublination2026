import type { AppRole } from "@/lib/auth/permissions";

export type DefectCategory = {
  category: string;
  label?: string;
  issues: string[];
};

// Keep existing storage keys so previously recorded defects remain compatible.
const allDefectCategories: DefectCategory[] = [
  { category: "Order information", label: "Front Desk", issues: ["Wrong garment or product", "Wrong size breakdown", "Wrong quantity", "Missing order instruction", "Price or payment does not match order", "Payment record is missing or incorrect"] },
  { category: "Design / artwork", label: "Artist", issues: ["Wrong spelling", "Wrong number", "Wrong size", "Wrong design", "Wrong pattern", "Name or number missing", "Personalization in wrong position", "Customer requested a design change"] },
  { category: "Printing", label: "Printing", issues: ["Missed print", "Damaged printing"] },
  { category: "Pressing", label: "Heat Press", issues: ["White line", "Flipped transfer", "Overheated", "Underheated", "Incomplete transfer", "Undersized fabric", "Oversized fabric", "Excessive spacing", "Fabric has a stain, hole, or mark", "Wrong fabric or material", "Fabric color or shade mismatch"] },
  { category: "Cutting", label: "Cutting", issues: ["Damaged cut", "Wrong set / pair", "Incomplete cutting"] },
  { category: "Sewing", label: "Sewing", issues: ["Delayed sewing", "Mismatched parts", "Below-quality sewing", "Missing parts", "Finished garment measures too small", "Finished garment measures too large", "Wrong size label"] },
  { category: "Missing piece", label: "Packaging", issues: ["Order shortage", "Missing item", "Damaged item", "Double print", "Below-quality item", "Released with an issue"] },
  { category: "Other", label: "Other", issues: ["Other issue (ask a supervisor to review)"] },
];

const categoriesByRole: Record<AppRole, string[]> = {
  admin: allDefectCategories.map(item => item.category),
  front_desk: ["Order information", "Design / artwork", "Missing piece", "Other"],
  artist: ["Order information", "Design / artwork", "Missing piece", "Other"],
  printing: ["Printing", "Design / artwork", "Pressing", "Missing piece", "Other"],
  heat_press: ["Pressing", "Printing", "Design / artwork", "Missing piece", "Other"],
  cutter: ["Cutting", "Pressing", "Missing piece", "Other"],
  sewer: ["Sewing", "Missing piece", "Other"],
  qc: allDefectCategories.map(item => item.category),
};

export function getDefectOptions(role: AppRole): DefectCategory[] {
  const available = new Set(categoriesByRole[role]);
  return allDefectCategories.filter(item => available.has(item.category));
}

export const defectComponents = [
  "Whole garment", "Front body", "Back body", "Left sleeve", "Right sleeve", "Collar / neckline",
  "Cuff", "Hem", "Side seam", "Pocket", "Player name", "Player number", "Logo / artwork", "Other / not sure",
];
