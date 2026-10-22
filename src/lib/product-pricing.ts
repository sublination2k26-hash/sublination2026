export const pricingServices = [
  { id: "full_garment", label: "Full garment", productionType: "full_garment" },
  { id: "subcon_print", label: "Sub-con print only", productionType: "print_only" },
  { id: "subcon_press", label: "Sub-con print & press", productionType: "print_only" },
  { id: "subcon_sewing", label: "Sub-con with sewing", productionType: "full_garment" },
] as const;
export type PricingService = typeof pricingServices[number]["id"];
export const serviceProductionStages: Record<PricingService, readonly string[]> = {
  full_garment: ["layout", "printing", "heat_press", "cutting", "sewing", "qc"],
  subcon_print: ["layout", "printing", "qc"],
  subcon_press: ["layout", "printing", "heat_press", "qc"],
  subcon_sewing: ["layout", "cutting", "sewing", "qc"],
};
const regular: Record<string, number> = { Jersey: 300, "T-shirt": 320, "Jersey + shorts set": 700, Polo: 480, "Chinese collar": 490, "Long sleeve": 480, Hoodie: 500 };
const print: Record<string, number> = { Jersey: 90, Shorts: 90, "T-shirt": 100, Polo: 110, "Long sleeve": 120, Hoodie: 140 };
const press: Record<string, number> = { Jersey: 200, Shorts: 200, "T-shirt": 210, Polo: 220, "Long sleeve": 220, Hoodie: 230 };
export function garmentPricing(service: PricingService): { garment: string; price: number | null }[] {
  const prices = service === "full_garment" ? regular : service === "subcon_press" ? press : service === "subcon_print" ? print : Object.fromEntries([...new Set([...Object.keys(regular), "Shorts"])].map(garment => [garment, null]));
  return [...Object.entries(prices).map(([garment, price]) => ({ garment, price })), { garment: "Special", price: null }];
}
