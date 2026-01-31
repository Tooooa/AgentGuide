/**
 * Hooks index - exports all hooks for easy importing.
 */

// Main simulation hook (large, but kept as the primary export for backward compatibility)
export { useSimulation } from './useSimulation';

// Modular helper hooks (extracted from useSimulation)
export { useScenarioManager } from './useScenarioManager';
export type { UseScenarioManagerReturn } from './useScenarioManager';

export { useEvaluation } from './useEvaluation';
export type { EvaluationResult, UseEvaluationReturn } from './useEvaluation';

export { useErasure } from './useErasure';
export type { UseErasureReturn } from './useErasure';
