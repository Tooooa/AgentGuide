/**
 * Hook for managing erasure simulation state.
 * Extracted from useSimulation for better separation of concerns.
 */
import { useState, useEffect } from 'react';


export interface UseErasureReturn {
    erasureRate: number;
    setErasureRate: React.Dispatch<React.SetStateAction<number>>;
    erasedIndices: Set<number>;
}


/**
 * Calculate which step indices should be "erased" for visualization.
 * Uses a deterministic hash to ensure consistent erasure patterns.
 */
export const useErasure = (currentStepIndex: number): UseErasureReturn => {
    const [erasureRate, setErasureRate] = useState(0);
    const [erasedIndices, setErasedIndices] = useState<Set<number>>(new Set());

    // Real-time Erasure Update Effect
    // This ensures that changing the slider immediately updates the visualization
    useEffect(() => {
        const newErasedIndices = new Set<number>();
        // Check all currently visible steps
        for (let i = 0; i <= currentStepIndex; i++) {
            // Use a stable hash to determine if this step is erased at the current rate
            // Hash function: (index * 2654435761) % 100
            // 2654435761 is Knuth's multiplicative hash constant (approx 2^32 * phi)
            const hash = (i * 2654435761) % 100;
            if (hash < erasureRate) {
                newErasedIndices.add(i);
            }
        }
        setErasedIndices(newErasedIndices);
    }, [erasureRate, currentStepIndex]);

    return {
        erasureRate,
        setErasureRate,
        erasedIndices,
    };
};
