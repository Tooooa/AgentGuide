import { useState, useEffect, useMemo } from 'react';
// import type { Trajectory } from '../types'; // Keep for type safety if needed, or remove if truly unused. 
// Actually, let's keep it but suppress if needed, or better, remove it if I am sure.
// Wait, I see no explicit usage in the file I viewed.
// Let's remove it.
import { useErasure } from './useErasure';
import { useEvaluation } from './useEvaluation';
import { useLiveSession } from './useLiveSession';
import { useHistory } from './useHistory';

export const useSimulation = () => {
    const [activeScenarioId, setActiveScenarioId] = useState<string>('empty-initial');

    // 1. History Hook
    const {
        savedScenarios,
        setSavedScenarios,
        refreshScenarios,
        deleteScenario,
        clearAllHistory,
        batchDeleteScenarios,
        togglePin
    } = useHistory();

    // 2. Live Session Hook
    const {
        apiKey, setApiKey,
        sessionId, setSessionId,
        liveScenario, setLiveScenario,
        isLoading, setIsLoading,
        isPlaying, setIsPlaying,
        currentStepIndex, setCurrentStepIndex,
        handleInitSession,
        handleNext,
        handlePrev,
        handleReset,
        handleContinue,
        handleNewConversation,
        customQuery, setCustomQuery,
        payload, setPayload
    } = useLiveSession(
        activeScenarioId,
        setActiveScenarioId,
        refreshScenarios
    );

    // 3. Erasure Hook
    const {
        erasureRate,
        setErasureRate,
        erasedIndices
    } = useErasure(currentStepIndex);

    // 4. Evaluation Hook
    const {
        evaluationResult,
        evaluationSessionId,
        isEvaluating,
        isEvaluationModalOpen,
        setEvaluationResult,
        setIsEvaluationModalOpen,
        evaluateSession,
        clearEvaluation,
        error: evaluationError
    } = useEvaluation();

    // Sync liveScenario to savedScenarios for real-time updates in history list
    useEffect(() => {
        if (liveScenario && liveScenario.id) {
            setSavedScenarios(prev => {
                const index = prev.findIndex(s => s.id === liveScenario.id);
                if (index >= 0) {
                    const updated = [...prev];
                    updated[index] = liveScenario;
                    return updated;
                }
                return prev;
            });
        }
    }, [liveScenario, setSavedScenarios]);

    // Evaluation Sync - only sync if evaluation belongs to current scenario
    useEffect(() => {
        if (activeScenarioId && activeScenarioId === liveScenario?.id && evaluationSessionId === activeScenarioId) {
            setLiveScenario(prev => prev ? ({ ...prev, evaluation: evaluationResult || undefined }) : null);
        }
    }, [evaluationResult, evaluationSessionId, activeScenarioId, liveScenario?.id, setLiveScenario]);


    const allScenarios = useMemo(() => {
        return [...savedScenarios];
    }, [savedScenarios]);

    const activeScenario = useMemo(() => {
        if (!activeScenarioId) {
            return {
                id: '',
                title: { en: 'No Conversation', zh: '无对话' },
                taskName: '',
                userQuery: '',
                totalSteps: 0,
                steps: []
            };
        }
        if (liveScenario && liveScenario.id === activeScenarioId) {
            return liveScenario;
        }
        const found = allScenarios.find(s => s.id === activeScenarioId);
        if (found) {
            return found;
        }
        // If we have a liveScenario but ID doesn't match, still use it if it's the expected one?
        // Prioritize live scenario if standard logic fails but user is in session?
        // Stick to activeScenarioId matching.

        return {
            id: 'empty-initial',
            title: { en: 'New Session', zh: '新会话' },
            taskName: 'New Session',
            userQuery: '',
            totalSteps: 0,
            steps: []
        };
    }, [activeScenarioId, liveScenario, allScenarios]);


    // Auto-load history when clicking on a saved scenario
    useEffect(() => {
        const loadHistoryScenario = async () => {
            const clickedScenario = savedScenarios.find(s => s.id === activeScenarioId);

            if (clickedScenario && clickedScenario.steps.length > 0) {
                if (!liveScenario || liveScenario.id !== activeScenarioId) {
                    setLiveScenario({
                        ...clickedScenario,
                        id: activeScenarioId
                    });
                    setCurrentStepIndex(clickedScenario.steps.length);
                    setIsPlaying(false);
                    setSessionId(activeScenarioId); // Allow continuing

                    // Clear any stale evaluation from previous scenario
                    clearEvaluation();
                    // Load evaluation from the clicked scenario if it exists
                    if (clickedScenario.evaluation) {
                        setEvaluationResult(clickedScenario.evaluation);
                    }
                }
            }
        };
        loadHistoryScenario();
    }, [activeScenarioId, savedScenarios, liveScenario, setLiveScenario, setCurrentStepIndex, setIsPlaying, setSessionId, setEvaluationResult, clearEvaluation]);

    // Clear evaluation when switching to a different scenario
    // This prevents stale evaluation from showing on unevaluated scenarios
    const [prevScenarioId, setPrevScenarioId] = useState<string | null>(null);
    useEffect(() => {
        if (activeScenarioId !== prevScenarioId) {
            setPrevScenarioId(activeScenarioId);
            // ALWAYS clear evaluation when switching scenarios
            clearEvaluation();
            // Then load evaluation from new scenario if it exists
            if (activeScenario?.evaluation) {
                setEvaluationResult(activeScenario.evaluation);
            }
        }
    }, [activeScenarioId, prevScenarioId, activeScenario?.evaluation, clearEvaluation, setEvaluationResult]);


    // History Management Wrappers
    const handleDeleteScenario = async (id: string) => {
        await deleteScenario(id);
        if (activeScenarioId === id) {
            // Logic moved from old useSimulation
            const remaining = savedScenarios.filter(s => s.id !== id);
            if (remaining.length > 0) {
                setActiveScenarioId(remaining[0].id);
            } else {
                handleNewConversation(); // Create new
            }
        }
        await refreshScenarios();
    };

    const handleClearAllHistory = async () => {
        await clearAllHistory();
        await handleNewConversation();
        await refreshScenarios();
    };

    const handleBatchDelete = async (ids: string[]) => {
        const result = await batchDeleteScenarios(ids);
        if (ids.includes(activeScenarioId)) {
            handleNewConversation();
        }
        await refreshScenarios();
        return result;
    };

    // History View State
    const [isHistoryViewOpen, setIsHistoryViewOpen] = useState(false);
    const [isComparisonMode, setIsComparisonMode] = useState(false);


    return {
        scenarios: allScenarios,
        activeScenario,
        activeScenarioId,
        setActiveScenarioId,
        refreshScenarios,
        isPlaying,
        setIsPlaying,
        currentStepIndex,
        erasureRate,
        setErasureRate,
        erasedIndices,
        handleReset,
        handleNext,
        handlePrev,
        visibleSteps: activeScenario.steps.slice(0, currentStepIndex),

        isComparisonMode,
        setIsComparisonMode,

        apiKey,
        setApiKey,
        handleInitSession,
        isLoading,
        setIsLoading,
        customQuery,
        setCustomQuery,
        payload,
        setPayload,
        sessionId,

        isHistoryViewOpen,
        setIsHistoryViewOpen,

        handleContinue,
        handleNewConversation: async () => {
            clearEvaluation();  // Clear evaluation state when starting new conversation
            await handleNewConversation();
        },

        evaluationResult,
        isEvaluating,
        isEvaluationModalOpen,
        setIsEvaluationModalOpen,
        evaluateSession: (lang?: string, force?: boolean) => evaluateSession(sessionId || activeScenarioId, activeScenario, lang, force),
        evaluationError,

        deleteScenario: handleDeleteScenario,
        clearAllHistory: handleClearAllHistory,
        batchDeleteScenarios: handleBatchDelete,
        togglePin
    };
};
