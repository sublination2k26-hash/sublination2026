export function sewerPaySummaries(rows: { employeeId: string; employee: string; mode: string; quantity: number; total: number }[]) {
    const result = new Map<string, { employee: string; regularPieces: number; regularPay: number; promoPieces: number; promoPay: number; pieces: number; total: number }>();
    for (const row of rows) {
      const value = result.get(row.employeeId) ?? { employee: row.employee, regularPieces: 0, regularPay: 0, promoPieces: 0, promoPay: 0, pieces: 0, total: 0 };
      if (row.mode === "regular") { value.regularPieces += row.quantity; value.regularPay += row.total; }
      if (row.mode === "promo") { value.promoPieces += row.quantity; value.promoPay += row.total; }
      value.pieces += row.quantity; value.total += row.total; result.set(row.employeeId, value);
    }
    return [...result.entries()].sort((a, b) => a[1].employee.localeCompare(b[1].employee));
}
