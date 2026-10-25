"""Block-skipping attention: skip (query block, key block) pairs with a small estimated score."""
import numpy as np

BLOCK = 64


def block_mask(q, k, threshold=1e-3):
    """Return a boolean mask over (query block, key block) pairs worth computing."""
    nq, nk = q.shape[0] // BLOCK, k.shape[0] // BLOCK
    mask = np.zeros((nq, nk), dtype=bool)
    for i in range(nq):
        qb = q[i * BLOCK:(i + 1) * BLOCK].mean(axis=0)
        for j in range(nk):
            kb = k[j * BLOCK:(j + 1) * BLOCK].mean(axis=0)
            mask[i, j] = abs(qb @ kb) / np.sqrt(q.shape[1]) > threshold
    return mask


def skip_attention(q, k, v):
    mask = block_mask(q, k)
    out = np.zeros_like(q)
    for i in range(mask.shape[0]):
        rows = slice(i * BLOCK, (i + 1) * BLOCK)
        cols = np.concatenate([np.arange(j * BLOCK, (j + 1) * BLOCK) for j in np.where(mask[i])[0]] or [np.arange(0)])
        if cols.size == 0:
            continue
        scores = q[rows] @ k[cols].T / np.sqrt(q.shape[1])
        weights = np.exp(scores - scores.max(axis=1, keepdims=True))
        weights /= weights.sum(axis=1, keepdims=True)
        out[rows] = weights @ v[cols]
    return out
