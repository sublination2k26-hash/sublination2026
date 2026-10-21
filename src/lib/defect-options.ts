import type { AppRole } from "@/lib/auth/permissions";

export type DefectCategory = {
  category: string;
  issues: string[];
};

const allDefectCategories: DefectCategory[] = [
  { category: "Order information", issues: ["Wrong garment or product", "Wrong size breakdown", "Wrong quantity", "Missing order instruction"] },
  { category: "Wrong name / text", issues: ["Name misspelled", "Number incorrect", "Name or number missing", "Personalization in wrong position"] },
  { category: "Design / artwork", issues: ["Wrong artwork or logo", "Artwork does not match approved proof", "Artwork is blurry or low resolution", "Color or placement differs from approved proof"] },
  { category: "Printing", issues: ["Faded or uneven print", "Wrong color", "Banding or streaks", "Blurry or smudged print", "Print is reversed", "Print is misaligned", "Part of design is missing"] },
  { category: "Pressing", issues: ["Ghosting or double image", "Faded or uneven transfer", "Scorch or heat mark", "Press outline or shine", "Color bleeding", "Transfer shifted", "Transfer paper stuck"] },
  { category: "Cutting", issues: ["Panel cut to wrong size", "Cut is crooked or uneven", "Panel or notch is missing", "Panel is cut in the wrong direction"] },
  { category: "Wrong size", issues: ["Finished garment measures too small", "Finished garment measures too large", "Wrong size label", "Size differs from the order breakdown"] },
  { category: "Sewing", issues: ["Skipped or broken stitches", "Open or loose seam", "Puckered or twisted seam", "Panels are misaligned", "Wrong panel joined", "Uneven hem or edge"] },
  { category: "Billing", issues: ["Price or payment does not match order", "Payment record is missing or incorrect"] },
  { category: "Material", issues: ["Fabric has a stain, hole, or mark", "Wrong fabric or material", "Fabric color or shade mismatch"] },
  { category: "Customer design change", issues: ["Customer requested a design change", "Approved artwork or personalization was updated"] },
  { category: "Missing piece", issues: ["Garment or set piece is missing", "Player or size item is missing", "Trim or accessory is missing"] },
  { category: "Other", issues: ["Other issue (ask a supervisor to review)"] },
];

const categoriesByRole: Record<AppRole, string[]> = {
  admin: allDefectCategories.map(item => item.category),
  front_desk: ["Order information", "Wrong name / text", "Design / artwork", "Billing", "Customer design change", "Missing piece", "Other"],
  artist: ["Order information", "Wrong name / text", "Design / artwork", "Customer design change", "Missing piece", "Other"],
  printing: ["Printing", "Wrong name / text", "Design / artwork", "Material", "Missing piece", "Other"],
  heat_press: ["Pressing", "Printing", "Material", "Wrong name / text", "Missing piece", "Other"],
  cutting_sewing: ["Cutting", "Sewing", "Material", "Wrong size", "Missing piece", "Other"],
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
