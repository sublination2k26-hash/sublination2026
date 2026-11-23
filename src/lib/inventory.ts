export type InventoryItem = {
  id: string;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  low_stock_level: number;
  updated_at: string;
};

export type InventoryMovement = {
  id: string;
  material_id: string;
  movement_type: "stock_in" | "deduction";
  quantity: number;
  movement_date: string;
  created_at: string;
};

export function stockStatus(item: Pick<InventoryItem, "quantity" | "low_stock_level">) {
  if (Number(item.quantity) === 0) return "Out of stock";
  return Number(item.quantity) <= Number(item.low_stock_level) ? "Low stock" : "In stock";
}
