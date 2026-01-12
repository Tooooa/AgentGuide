
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { scenarios } from '../data/mockData';
import type { Trajectory, Step } from '../data/mockData';
import { api } from '../services/api';


export const useSimulation = () => {
    // Static State
    const [savedScenarios, setSavedScenarios] = useState<Trajectory[]>([]);
    const [activeScenarioId, setActiveScenarioId] = useState<string>(scenarios[0].id);
    const [customQuery, setCustomQuery] = useState<string>("");
    const [payload, setPayload] = useState<string>("1101"); // Default binary string

    // Live State
    const [isLiveMode, setIsLiveMode] = useState(true);
    const [apiKey, setApiKey] = useState("sk-7f4e6c78384e4aaab0eb0c59af411618");
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [liveScenario, setLiveScenario] = useState<Trajectory | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Common State
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [erasureRate, setErasureRate] = useState(0);
    const [erasedIndices, setErasedIndices] = useState<Set<number>>(new Set());

    // Evaluation State
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [evaluationResult, setEvaluationResult] = useState<{ model_a_score: number, model_b_score: number, reason: string } | null>(null);
    const [isEvaluationModalOpen, setIsEvaluationModalOpen] = useState(false);


    // Refresh saved scenarios
    const refreshScenarios = useCallback(async () => {
        try {
            const saved = await api.listScenarios();
            setSavedScenarios(saved);
        } catch (e) {
            console.error("Failed to load saved scenarios", e);
        }
    }, []);

    // Initial Load
    useEffect(() => {
        refreshScenarios();
    }, [refreshScenarios]);

    const allScenarios = useMemo(() => {
        const savedMap = new Map(savedScenarios.map(s => [s.id, s]));
        const merged = [...savedScenarios];

        // Add static scenarios only if not present in saved (by ID)
        scenarios.forEach(s => {
            if (!savedMap.has(s.id)) {
                merged.push(s);
            }
        });

        // Sort optional? or keep order: Saved (Recent) -> Mock (Static).
        // Sidebar usually expects them mixed or sorted. 
        // For now, Saved first, then remaining Mocks.
        return merged;
    }, [savedScenarios]);

    // Derived Active Scenario
    const activeScenario = useMemo(() => {
        if (isLiveMode && liveScenario) {
            if (!sessionId || activeScenarioId === sessionId) {
                return liveScenario;
            }
        }
        // 如果 activeScenarioId 为空字符串，返回一个空场景
        if (!activeScenarioId) {
            return {
                id: '',
                title: { en: '', zh: '' },
                taskName: '',
                userQuery: '',
                totalSteps: 0,
                steps: []
            } as Trajectory;
        }
        return allScenarios.find(s => s.id === activeScenarioId) || allScenarios[0];
    }, [activeScenarioId, isLiveMode, liveScenario, allScenarios, sessionId]);

    // Sync evaluation result when active scenario changes
    useEffect(() => {
        if (activeScenario && activeScenario.evaluation) {
            setEvaluationResult(activeScenario.evaluation);
        } else {
            setEvaluationResult(null);
        }
        setIsEvaluationModalOpen(false);
    }, [activeScenarioId, activeScenario]); // Re-run if scenario content updates (e.g. after eval)


    const timerRef = useRef<number | null>(null);

    const handleReset = useCallback(() => {
        setIsPlaying(false);
        setCurrentStepIndex(0);
        setErasedIndices(new Set());

        if (isLiveMode) {
            setSessionId(null);
            setLiveScenario(null);
            setCustomQuery("");
        }
    }, [isLiveMode]);

    // Live Session Init
    const handleInitSession = useCallback(async () => {
        if (!apiKey) return;
        setIsLoading(true);
        try {
            let data;
            if (customQuery) {
                data = await api.initCustomSession(apiKey, customQuery, payload);
            } else {
                data = await api.initSession(apiKey, activeScenarioId, payload);
            }

            setSessionId(data.sessionId);
            setActiveScenarioId(data.sessionId); // Force ControlPanel to switch to live scenario
            setLiveScenario({
                id: data.task.id,
                title: { en: "Live Session", zh: "实时会话" }, // Can be improved
                taskName: "Live Execution",
                userQuery: data.task.query,
                totalSteps: 0,
                steps: []
            });
            setCurrentStepIndex(0);
            setErasedIndices(new Set());
            setIsPlaying(true); // Auto-play after init
        } catch (e) {
            console.error(e);
            alert("Failed to init session");
        } finally {
            setIsLoading(false);
        }
    }, [apiKey, activeScenarioId, customQuery, payload]);

    const [isComparisonMode, setIsComparisonMode] = useState(false);

    // ...

    const handleNext = useCallback(async () => {
        // Live Mode Logic
        if (isLiveMode) {
            if (!sessionId || !liveScenario) return;

            // Check Termination Condition
            const lastStep = liveScenario.steps[liveScenario.steps.length - 1];
            if (lastStep) {
                const wmDone = lastStep.stepType === 'finish' || !!lastStep.finalAnswer;
                const blDone = lastStep.baseline?.stepType === 'finish' || !!lastStep.baseline?.finalAnswer;

                // Always wait for BOTH agents to finish, regardless of mode.
                if (wmDone && blDone) {
                    setIsPlaying(false);
                    return;
                }

                // If one is done but not the other, we proceed.
                // But backend might return empty for the one that is done?
                // That's fine, we just update the one that is running.
            }

            // Prevent stepping if we are already at the end of what we have fetched...
            // UNLESS we are fetching a NEW step.
            // Logic: "Next" in live mode triggers generation of the next step.

            setIsLoading(true);
            try {
                // Create a placeholder step for streaming
                const initialStepIndex = liveScenario.steps.length;
                let currentThought = "";
                let currentBaselineThought = "";

                // Determine if agents are already done to avoid showing "Thinking..."
                const prevSteps = liveScenario.steps;
                const isWmPreDone = prevSteps.some(s => s.stepType === 'finish' || !!s.finalAnswer);
                const isBlPreDone = prevSteps.some(s => s.baseline?.stepType === 'finish' || !!s.baseline?.finalAnswer);

                // Add initial empty step
                setLiveScenario(prev => {
                    if (!prev) return null;
                    const placeholderStep: Step = {
                        stepIndex: initialStepIndex,
                        thought: isWmPreDone ? "" : "Thinking...",
                        action: "",
                        distribution: [],
                        watermark: { bits: "", matrixRows: [], rankContribution: 0 },
                        stepType: isWmPreDone ? 'tool' : 'tool', // Avoid 'finish' to prevent duplicate UI card
                        toolDetails: "",
                        isHidden: isWmPreDone,
                        baseline: {
                            thought: isBlPreDone ? "" : "Thinking...",
                            action: "",
                            distribution: [],
                            toolDetails: "",
                            stepType: isBlPreDone ? 'tool' : 'tool', // Avoid 'finish' here too
                            isHidden: isBlPreDone
                        }
                    };
                    return {
                        ...prev,
                        totalSteps: prev.steps.length + 1,
                        steps: [...prev.steps, placeholderStep]
                    };
                });

                // Move cursor immediately
                setCurrentStepIndex(prev => prev + 1);

                await api.stepStream(sessionId, (chunk) => {
                    if (chunk.type === 'thought') {
                        if (chunk.content) {
                            if (chunk.agent === 'baseline') {
                                currentBaselineThought += chunk.content;
                                setLiveScenario(prev => {
                                    if (!prev) return null;
                                    const steps = [...prev.steps];
                                    if (steps[initialStepIndex]) {
                                        // Ensure baseline object exists
                                        const baseline = steps[initialStepIndex].baseline || {
                                            thought: "", action: "", distribution: [], toolDetails: "", stepType: 'tool'
                                        };
                                        steps[initialStepIndex] = {
                                            ...steps[initialStepIndex],
                                            baseline: {
                                                ...baseline,
                                                thought: currentBaselineThought
                                            }
                                        };
                                    }
                                    return { ...prev, steps };
                                });
                            } else {
                                // Default to watermarked
                                currentThought += chunk.content;
                                setLiveScenario(prev => {
                                    if (!prev) return null;
                                    const steps = [...prev.steps];
                                    if (steps[initialStepIndex]) {
                                        steps[initialStepIndex] = {
                                            ...steps[initialStepIndex],
                                            thought: currentThought
                                        };
                                    }
                                    return { ...prev, steps };
                                });
                            }
                        }
                    } else if (chunk.type === 'result') {
                        const stepData = chunk.data;
                        const targetAgent = stepData.agent || 'watermarked'; // default to watermarked if missing

                        setLiveScenario(prev => {
                            if (!prev) return null;
                            const steps = [...prev.steps];
                            if (!steps[initialStepIndex]) return prev;

                            const existingStep = steps[initialStepIndex];

                            if (targetAgent === 'watermarked') {
                                // Update Main (Watermarked) Data
                                steps[initialStepIndex] = {
                                    ...existingStep,
                                    thought: stepData.thought || existingStep.thought,
                                    action: stepData.action,
                                    distribution: stepData.distribution || [],
                                    watermark: {
                                        bits: stepData.watermark?.bits || "",
                                        matrixRows: stepData.watermark?.matrixRows || [],
                                        rankContribution: stepData.watermark?.rankContribution || 0
                                    },
                                    stepType: stepData.done ? 'finish' : 'tool',
                                    toolDetails: stepData.observation,
                                    metrics: stepData.metrics,
                                    finalAnswer: stepData.done ? (stepData.final_answer || stepData.thought || "") : undefined
                                };
                            } else if (targetAgent === 'baseline') {
                                // Update Baseline Data
                                steps[initialStepIndex] = {
                                    ...existingStep,
                                    baseline: {
                                        thought: stepData.thought || "",
                                        action: stepData.action,
                                        toolDetails: stepData.observation,
                                        distribution: stepData.distribution || [],
                                        stepType: stepData.done ? 'finish' : 'tool',
                                        finalAnswer: stepData.done ? (stepData.final_answer || stepData.thought || "") : undefined,
                                        metrics: stepData.metrics
                                    }
                                };
                            }

                            return { ...prev, steps };
                        });

                        // REMOVED premature stop here. 
                        // Termination is now handled at start of next loop.
                    }
                });

            } catch (e) {
                console.error(e);
            } finally {
                setIsLoading(false);
            }
            return;
        }

        // Static Logic
        if (currentStepIndex < activeScenario.totalSteps) {
            setCurrentStepIndex(prev => prev + 1);
        }
    }, [currentStepIndex, activeScenario, isLiveMode, sessionId, liveScenario]);

    const handlePrev = useCallback(() => {
        if (currentStepIndex > 0) {
            setCurrentStepIndex(prev => prev - 1);
        }
    }, [currentStepIndex]);

    // Real-time Erasure Update Effect
    // This ensures that changing the slider immediately updates the visualization
    useEffect(() => {
        const newErasedIndices = new Set<number>();
        // Check all currently visible steps
        for (let i = 0; i <= currentStepIndex; i++) {
            // Use a stable hash to determine if this step is erased at the current rate
            // This ensures meaningful control: higher rate = more erased, lower = less.
            // Hash function: (index * 2654435761) % 100
            // 2654435761 is Knuth's multiplicative hash constant (approx 2^32 * phi)
            const hash = (i * 2654435761) % 100;
            if (hash < erasureRate) {
                newErasedIndices.add(i);
            }
        }
        setErasedIndices(newErasedIndices);
    }, [erasureRate, currentStepIndex]); // Re-run when rate changes or we step forward

    // Timer Logic (Auto Play)
    useEffect(() => {
        if (isPlaying) {
            timerRef.current = window.setInterval(async () => {
                if (isLiveMode) {
                    if (isLoading) return; // Wait for request
                    await handleNext();
                } else {
                    setCurrentStepIndex(prev => {
                        if (prev >= activeScenario.totalSteps) {
                            setIsPlaying(false);
                            return prev;
                        }
                        return prev + 1;
                    });
                }
            }, isLiveMode ? 2000 : 1000); // Slower for live mode API calls
        } else {
            if (timerRef.current) clearInterval(timerRef.current);
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [isPlaying, activeScenario, isLiveMode, isLoading, handleNext]);

    return {
        scenarios: allScenarios,
        activeScenario,
        activeScenarioId,
        setActiveScenarioId,
        refreshScenarios, // Exported
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
        // Live Mode Props
        isLiveMode,
        setIsLiveMode,
        isComparisonMode, // New
        setIsComparisonMode, // New
        apiKey,
        setApiKey,
        handleInitSession,
        isLoading,
        customQuery,
        setCustomQuery,
        payload,
        setPayload,
        sessionId,


        handleContinue: async (prompt: string) => {
            // Case 0: New Session (No Session ID yet)
            if (!sessionId && isLiveMode) {
                // Initialize Session with this prompt as the custom query
                setIsLoading(true);
                setCustomQuery(prompt);
                try {
                    // We need to call API to init
                    // But handleInitSession depends on state that might not be set yet if we just call it.
                    // Let's call API directly or set state and call handleInitSession?
                    // handleInitSession reads customQuery from state.
                    // So we set it, but state update is async.
                    // Better to duplicate init logic or extract it.
                    // Let's call api directly.

                    const data = await api.initCustomSession(apiKey, prompt, payload);

                    setSessionId(data.sessionId);
                    setActiveScenarioId(data.sessionId);
                    setLiveScenario({
                        id: data.task.id,
                        title: { en: "Live Session", zh: "实时会话" },
                        taskName: "Live Execution",
                        userQuery: data.task.query,
                        totalSteps: 0,
                        steps: []
                    });
                    setCurrentStepIndex(0);
                    setErasedIndices(new Set());
                    setIsPlaying(true);
                } catch (e) {
                    console.error(e);
                    alert("Failed to start new session");
                } finally {
                    setIsLoading(false);
                }
                return;
            }

            // Restore session if needed (e.g. continuing from history)
            let currentSessionId = sessionId;
            if (!currentSessionId || currentSessionId !== activeScenarioId) {
                // Determine valid ID to restore
                // If activeScenarioId is a saved ID (not a live session ID which starts with sess_), we can restore it.
                // Actually live session IDs also start with sess_, but if it's not the *current* sessionId, we need to restore context.
                // However, our backend doesn't persist 'active' memory across server restarts unless we hydrate it.
                // So if we are viewing a history item (saved scenario), it has an ID.
                // We call restore_session with that ID.

                setIsLoading(true);
                try {
                    const data = await api.restoreSession(apiKey, activeScenarioId);
                    currentSessionId = data.sessionId;
                    setSessionId(currentSessionId);

                    // We must also ensure liveScenario is set to activeScenario so UI updates correctly
                    // activeScenario is already the history item. We clone it to liveScenario.
                    // Wait, if we restore, we should switch to "Live Mode" fully.
                    setLiveScenario({ ...activeScenario });
                    setIsLiveMode(true);

                    // Small delay to ensure state updates? 
                    // No, we use local var currentSessionId for next call.
                } catch (e) {
                    console.error("Failed to restore session", e);
                    alert("Failed to restore previous session. It might be incompatible.");
                    setIsLoading(false);
                    return;
                }
            }

            // Inject User Step locally for display (Optimistic UI)
            setLiveScenario(prev => {
                if (!prev) return null; // Should not happen if restored above
                const userStep: Step = {
                    stepIndex: prev.steps.length,
                    thought: prompt,
                    action: "",
                    distribution: [],
                    watermark: { bits: "", matrixRows: [], rankContribution: 0 },
                    stepType: 'user_input'
                };
                return {
                    ...prev,
                    totalSteps: prev.steps.length + 1,
                    steps: [...prev.steps, userStep]
                };
            });
            setCurrentStepIndex(prev => prev + 1);

            setIsLoading(true);
            try {
                await api.continueSession(currentSessionId!, prompt);
                setIsPlaying(true);
            } catch (e) {
                console.error(e);
                alert("Failed to continue session");
            } finally {
                setIsLoading(false);
            }

        },

        handleNewConversation: async () => {
            // Auto Save current if valid
            if (isLiveMode && liveScenario && liveScenario.steps.length > 0) {
                try {
                    // Generate Title if needed (or assume backend default if we send empty, 
                    // but backend needs history to gen title, so we must call generateTitle first or let handleSave do it)
                    // Let's generate title first if title is default
                    let titleToSave = liveScenario.title;
                    if ((!titleToSave.en || titleToSave.en === "Live Session") && liveScenario.steps.length > 0) {
                        try {
                            const res = await api.generateTitle(liveScenario.steps.map(s => ({
                                role: s.stepType === 'user_input' ? 'user' : (s.stepType === 'tool' ? 'tool' : 'assistant'),
                                message: s.thought || s.toolDetails || s.action // approximation
                            })));
                            if (res.title) {
                                titleToSave = { en: res.title, zh: res.title };
                            }
                        } catch (err) {
                            console.warn("Title Gen Failed", err);
                        }
                    }

                    await api.saveScenario(typeof titleToSave === 'string' ? titleToSave : titleToSave.en, {
                        ...liveScenario,
                        title: titleToSave
                    });
                    refreshScenarios(); // Refresh list
                } catch (e) {
                    console.error("Auto Save Failed", e);
                }
            }

            // Reset for New Conversation (Stay in Live Mode)
            setIsPlaying(false);
            setCurrentStepIndex(0);
            setErasedIndices(new Set());
            setSessionId(null);
            setCustomQuery("");

            // Set empty live scenario so UI shows empty state
            const newEmptyScenario: Trajectory = {
                id: `new-${Date.now()}`,
                title: { en: "New Session", zh: "新会话" },
                taskName: "New Session",
                userQuery: "", // Empty for clean UI
                totalSteps: 0,
                steps: []
            };
            setLiveScenario(newEmptyScenario);
            setActiveScenarioId(newEmptyScenario.id); // Ensure this is active
            setIsLiveMode(true);
        },

        saveCurrentScenario: async () => {
            if (activeScenario) {
                // If it's a temp ID (starts with 'new-'), pass undefined to create new, else pass ID to update
                const idToUpdate = activeScenario.id.startsWith("new-") ? undefined : activeScenario.id;
                const res = await api.saveScenario(activeScenario.title.en, activeScenario, idToUpdate);

                // If we got a new ID (was temp), update the scenario in state
                if (res.id && activeScenario.id !== res.id) {
                    if (isLiveMode && liveScenario && liveScenario.id === activeScenario.id) {
                        setLiveScenario(prev => prev ? ({ ...prev, id: res.id }) : null);
                    }
                }
                await refreshScenarios();
            }
        },




        // Evaluation
        evaluationResult,
        isEvaluating,
        setEvaluationResult,
        isEvaluationModalOpen, // Export
        setIsEvaluationModalOpen, // Export
        evaluateSession: async (language: string = "en") => {
            if (!sessionId) return;

            // Note: If result exists, we ideally check if language matches? 
            // For now, simple caching: if result exists, show it regardless of language or we clear it if language changes?
            // Users might toggle language and expect re-evaluation? 
            // Let's assume re-click with result just opens modal. 
            // If they really want re-eval in new language, they might need to reset or we check cache key.
            // For simplicity: stick to cache. If they want zh, they should set zh before evaluating.

            if (evaluationResult) {
                setIsEvaluationModalOpen(true);
                return;
            }

            setIsEvaluating(true);
            setIsEvaluationModalOpen(true);
            try {
                const result = await api.evaluateSession(sessionId, language);
                setEvaluationResult(result);

                // Update liveScenario to persist this result in memory for now
                if (liveScenario && activeScenarioId === liveScenario.id) {
                    setLiveScenario(prev => prev ? ({ ...prev, evaluation: result }) : null);
                }

                // Also update savedScenarios if it exists there
                setSavedScenarios(prev => prev.map(s =>
                    s.id === sessionId ? { ...s, evaluation: result } : s
                ));

            } catch (e) {
                console.error("Evaluation failed", e);
                alert("Evaluation failed. Please try again.");
                setIsEvaluationModalOpen(false); // Close on error
            } finally {
                setIsEvaluating(false);
            }
        }
    };
};

