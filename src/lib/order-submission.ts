export type OrderSubmissionProgress = { orderId?: string; pending?: Promise<string> };

// Later steps (customization, artwork, refresh) may fail after creation commits.
// Retrying those steps must keep the original order and production tasks.
export function createOrderOnce(progress: OrderSubmissionProgress, create: () => Promise<string>): Promise<string> {
  if (progress.orderId) return Promise.resolve(progress.orderId);
  if (progress.pending) return progress.pending;
  const pending = create().then(id => {
    progress.orderId = id;
    return id;
  });
  progress.pending = pending;
  void pending.then(
    () => { progress.pending = undefined; },
    () => { progress.pending = undefined; },
  );
  return pending;
}
