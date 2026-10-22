export function withWorkspaceTimeout<T>(operation: PromiseLike<T>, milliseconds = 20000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Loading took too long. Check your connection and try again.")), milliseconds);
    Promise.resolve(operation).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

export function groupByOrder<T extends { order_id: string }>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const group = grouped.get(row.order_id);
    if (group) group.push(row);
    else grouped.set(row.order_id, [row]);
  }
  return grouped;
}
