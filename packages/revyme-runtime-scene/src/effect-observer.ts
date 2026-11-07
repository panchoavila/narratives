/** Re-scan only when a mutation can add, remove, or change an effect target. */
export function effectTargetsChanged(records: MutationRecord[]): boolean {
  return records.some(record => {
    if (record.type === 'attributes') return true;
    return [...record.addedNodes, ...record.removedNodes].some(node =>
      node instanceof Element &&
      (node.matches('[data-canvas-effect]') || !!node.querySelector('[data-canvas-effect]'))
    );
  });
}
