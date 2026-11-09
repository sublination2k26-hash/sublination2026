type CuttingOrder = {
  status: string;
  stage: string;
  productionTasks: { stage: string; status: string }[];
};

export function isWaitingForCutting(order: CuttingOrder): boolean {
  if (["cancelled", "released", "ready_for_release"].includes(order.status)) return false;
  if (["Cutting", "Sewing", "Quality check", "Ready for release", "Released"].includes(order.stage)) return false;
  return order.productionTasks.some(task => task.stage === "cutting" && task.status !== "completed");
}
