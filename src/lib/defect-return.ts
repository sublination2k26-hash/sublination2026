export type DefectReturnProgress = {
  inserted: boolean;
  routed: boolean;
  pending?: Promise<void>;
};

// Keep successful steps when routing or the subsequent dashboard refresh fails.
export function saveDefectReturn(
  progress: DefectReturnProgress,
  operations: { insert: () => Promise<void>; route: () => Promise<void> },
): Promise<void> {
  if (progress.pending) return progress.pending;
  const pending = (async () => {
    if (!progress.inserted) {
      await operations.insert();
      progress.inserted = true;
    }
    if (!progress.routed) {
      await operations.route();
      progress.routed = true;
    }
  })();
  progress.pending = pending;
  void pending.then(
    () => { progress.pending = undefined; },
    () => { progress.pending = undefined; },
  );
  return pending;
}
