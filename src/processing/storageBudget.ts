const FALLBACK_STORAGE_BUDGET_BYTES = 512 * 1024 * 1024
const SAFE_STORAGE_FRACTION = 0.8

type StorageBudgetEstimate = {
  quota?: number
  usage?: number
}

export function shouldUseTemporaryMode(
  selectionBytes: number,
  estimate?: StorageBudgetEstimate,
): boolean {
  if (estimate?.quota === undefined || !Number.isFinite(estimate.quota)) {
    return selectionBytes > FALLBACK_STORAGE_BUDGET_BYTES
  }

  const availableBytes = Math.max(0, estimate.quota - (estimate.usage ?? 0))
  return selectionBytes > availableBytes * SAFE_STORAGE_FRACTION
}

export async function estimateTemporaryMode(selectionBytes: number): Promise<boolean> {
  try {
    if (typeof navigator.storage?.estimate === 'function') {
      return shouldUseTemporaryMode(selectionBytes, await navigator.storage.estimate())
    }
  } catch (reason) {
    console.warn('Não foi possível estimar o espaço local do navegador; usando um limite conservador.', reason)
  }

  return shouldUseTemporaryMode(selectionBytes)
}
