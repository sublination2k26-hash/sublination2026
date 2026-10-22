type PaySettings = { salary_basis: "fixed" | "piece" | "combined"; base_rate: number; pay_frequency: string };
type PayRecord = { quantity: number; unit_rate: number; pay_eligible: boolean };
export function workPayDisplay(record: PayRecord, settings?: PaySettings) {
  return {
    fixedRate: settings && settings.salary_basis !== "piece" ? Number(settings.base_rate) : null,
    frequency: settings?.pay_frequency ?? null,
    outputPay: settings?.salary_basis === "fixed" ? null : record.pay_eligible ? Number(record.quantity) * Number(record.unit_rate) : null,
    outputExcluded: settings?.salary_basis !== "fixed" && !record.pay_eligible,
    needsSettings: !settings,
    zeroOutputRate: settings?.salary_basis !== "fixed" && record.pay_eligible && Number(record.unit_rate) === 0,
  };
}
