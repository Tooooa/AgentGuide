/**
 * Hook for managing evaluation state and operations.
 * Extracted from useSimulation for better separation of concerns.
 * 
 * IMPORTANT: evaluationSessionId tracks which session the current evaluation belongs to.
 * This prevents evaluation state from leaking between different conversations.
 */
import { useState, useCallback } from 'react';
import { api } from '../services/api';


export interface EvaluationResult {
    model_a_score: number;
    model_b_score: number;
    reason: string;
}


export interface UseEvaluationReturn {
    evaluationResult: EvaluationResult | null;
    evaluationSessionId: string | null;  // Track which session the evaluation belongs to
    isEvaluating: boolean;
    isEvaluationModalOpen: boolean;
    error: string | null;
    setEvaluationResult: React.Dispatch<React.SetStateAction<EvaluationResult | null>>;
    setIsEvaluationModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
    evaluateSession: (sessionId: string, scenario: any, language?: string, force?: boolean) => Promise<EvaluationResult | null>;
    clearEvaluation: () => void;
    setError: React.Dispatch<React.SetStateAction<string | null>>;
}


export const useEvaluation = (): UseEvaluationReturn => {
    const [evaluationResult, setEvaluationResult] = useState<EvaluationResult | null>(null);
    const [evaluationSessionId, setEvaluationSessionId] = useState<string | null>(null);
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [isEvaluationModalOpen, setIsEvaluationModalOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const clearEvaluation = useCallback(() => {
        setEvaluationResult(null);
        setEvaluationSessionId(null);
        setError(null);
    }, []);

    const evaluateSession = useCallback(async (
        sessionId: string,
        scenario: any,  // The scenario object to save evaluation to
        language: string = "en",
        force: boolean = false
    ): Promise<EvaluationResult | null> => {
        if (!sessionId) {
            console.error('[Evaluate] No session ID provided');
            return null;
        }

        setError(null);

        // Only return cached result if it's for the same session
        if (evaluationResult && evaluationSessionId === sessionId && !force) {
            setIsEvaluationModalOpen(true);
            return evaluationResult;
        }

        setIsEvaluating(true);
        setIsEvaluationModalOpen(true);

        try {
            console.log('[Evaluate] Evaluating session:', sessionId);
            const result = await api.evaluateSession(sessionId, language);
            console.log('[Evaluate] Evaluation result:', result);
            setEvaluationResult(result);
            setEvaluationSessionId(sessionId);

            // Save evaluation to database immediately
            if (scenario && result) {
                try {
                    const updatedScenario = {
                        ...scenario,
                        id: sessionId,
                        evaluation: result
                    };
                    await api.saveScenario(updatedScenario.title, updatedScenario, sessionId);
                    console.log('[Evaluate] Saved evaluation to database for session:', sessionId);
                } catch (saveError) {
                    console.error('[Evaluate] Failed to save evaluation to database:', saveError);
                }
            }

            return result;
        } catch (e: any) {
            console.error("Evaluation failed", e);
            const errorMsg = e.response?.data?.detail || e.message || "Unknown error";
            setError(errorMsg);
            return null;
        } finally {
            setIsEvaluating(false);
        }
    }, [evaluationResult, evaluationSessionId]);

    return {
        evaluationResult,
        evaluationSessionId,
        isEvaluating,
        isEvaluationModalOpen,
        error,
        setEvaluationResult,
        setIsEvaluationModalOpen,
        evaluateSession,
        clearEvaluation,
        setError,
    };
};
