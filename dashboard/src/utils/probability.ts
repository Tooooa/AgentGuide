export function roundNormalizedProbsToSumOne(values: number[], decimals = 3): number[] {
    if (!values.length) return [];

    const factor = 10 ** decimals;

    const cleaned = values.map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0));
    const total = cleaned.reduce((a, b) => a + b, 0);
    const normalized = total > 0 ? cleaned.map((v) => v / total) : cleaned.map(() => 1 / cleaned.length);

    const scaled = normalized.map((v) => v * factor);
    const floored = scaled.map((v) => Math.floor(v));

    const target = factor;
    let current = floored.reduce((a, b) => a + b, 0);
    const remainders = scaled.map((v, i) => ({ i, r: v - floored[i] }));

    if (current < target) {
        remainders.sort((a, b) => b.r - a.r);
        let need = target - current;
        for (let j = 0; j < need; j++) {
            floored[remainders[j % remainders.length].i] += 1;
        }
    } else if (current > target) {
        remainders.sort((a, b) => a.r - b.r);
        let need = current - target;
        for (let j = 0; j < remainders.length && need > 0; j++) {
            const idx = remainders[j].i;
            if (floored[idx] > 0) {
                floored[idx] -= 1;
                need -= 1;
                j -= 1;
            }
        }
    }

    const rounded = floored.map((n) => n / factor);
    const sum = rounded.reduce((a, b) => a + b, 0);
    if (rounded.length && sum !== 1) {
        rounded[rounded.length - 1] = Math.max(0, rounded[rounded.length - 1] + (1 - sum));
    }
    return rounded;
}

