
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { scenarios } from '../data/mockData';
import type { Trajectory, Step } from '../data/mockData';
import { api } from '../services/api';


export const useSimulation = () => {
    // Static State
    const [savedScenarios, setSavedScenarios] = useState<Trajectory[]>([]);
    const [activeScenarioId, setActiveScenarioId] = useState<string>('empty-initial'); // 使用一个不存在的ID，确保初始为空
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

    // History View State
    const [isHistoryViewOpen, setIsHistoryViewOpen] = useState(false);


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
        // Always merge saved scenarios with mock scenarios
        // Saved scenarios (real history) come first
        const savedMap = new Map(savedScenarios.map(s => [s.id, s]));
        const merged = [...savedScenarios];

        // Add mock scenarios only if not present in saved (by ID)
        // and only in non-live mode
        if (!isLiveMode) {
            scenarios.forEach(s => {
                if (!savedMap.has(s.id)) {
                    merged.push(s);
                }
            });
        }

        return merged;
    }, [savedScenarios, isLiveMode]);

    // Derived Active Scenario
    const activeScenario = useMemo(() => {
        // If no scenario is selected (empty ID), return empty scenario
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
        
        // Priority 1: If we have a liveScenario and it matches activeScenarioId, use it
        if (isLiveMode && liveScenario && liveScenario.id === activeScenarioId) {
            return liveScenario;
        }
        
        // Priority 2: Find in allScenarios (includes saved scenarios)
        const found = allScenarios.find(s => s.id === activeScenarioId);
        if (found) {
            return found;
        }
        
        // Priority 3: If we have a liveScenario but ID doesn't match, still use it (current session)
        if (isLiveMode && liveScenario) {
            return liveScenario;
        }
        
        // Fallback: Empty scenario (not first from list)
        return {
            id: 'empty-initial',
            title: { en: 'New Session', zh: '新会话' },
            taskName: 'New Session',
            userQuery: '', // 空的userQuery
            totalSteps: 0,
            steps: []
        };
    }, [activeScenarioId, isLiveMode, liveScenario, allScenarios]);

    // Sync evaluation result when active scenario changes
    useEffect(() => {
        if (activeScenario && activeScenario.evaluation) {
            setEvaluationResult(activeScenario.evaluation);
        } else {
            setEvaluationResult(null);
        }
        setIsEvaluationModalOpen(false);
    }, [activeScenarioId, activeScenario]); // Re-run if scenario content updates (e.g. after eval)

    // Auto-load history when clicking on a saved scenario
    useEffect(() => {
        const loadHistoryScenario = async () => {
            // Check if user clicked on a saved scenario (not current live session)
            const clickedScenario = savedScenarios.find(s => s.id === activeScenarioId);
            
            if (isLiveMode && clickedScenario && clickedScenario.steps.length > 0) {
                // Check if it's different from current liveScenario
                if (!liveScenario || liveScenario.id !== activeScenarioId) {
                    // Load the scenario into view with correct ID
                    setLiveScenario({
                        ...clickedScenario,
                        id: activeScenarioId // Ensure ID matches
                    });
                    setCurrentStepIndex(clickedScenario.steps.length);
                    setIsPlaying(false);
                    
                    // Set sessionId to match the clicked scenario
                    // This allows continuing the conversation
                    setSessionId(activeScenarioId);
                    
                    // Load evaluation result if exists
                    if (clickedScenario.evaluation) {
                        setEvaluationResult(clickedScenario.evaluation);
                    } else {
                        setEvaluationResult(null);
                    }
                }
            }
        };
        
        loadHistoryScenario();
    }, [activeScenarioId, savedScenarios, isLiveMode]);

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

            // Check Termination Condition - only check the LAST step
            // We don't check all steps because historical completed steps shouldn't block new conversations
            // After continue_session, the backend resets done state, so we should allow new steps
            const stepsForStatus = liveScenario.steps;
            const getWmDone = () => {
                for (let i = stepsForStatus.length - 1; i >= 0; i--) {
                    const s = stepsForStatus[i];
                    if (s.stepType === 'user_input') continue;
                    if (s.isHidden) continue;
                    return s.stepType === 'finish' || !!s.finalAnswer;
                }
                return false;
            };
            const getBlDone = () => {
                for (let i = stepsForStatus.length - 1; i >= 0; i--) {
                    const s = stepsForStatus[i];
                    if (s.stepType === 'user_input') continue;
                    const b = s.baseline;
                    if (!b) continue;
                    if (b.isHidden) continue;
                    return b.stepType === 'finish' || !!b.finalAnswer;
                }
                return false;
            };

            const lastStep = stepsForStatus[stepsForStatus.length - 1];
            if (lastStep && lastStep.stepType !== 'user_input') {
                const wmDone = getWmDone();
                const blDone = getBlDone();
                if (wmDone && blDone) {
                    setIsPlaying(false);
                    return;
                }
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

                // Determine if agents are still running by checking last non-user step
                // After user continuation, agents should NOT be considered "done"
                const prevSteps = liveScenario.steps;
                const lastNonUserStep = [...prevSteps].reverse().find(s => s.stepType !== 'user_input');

                // If last step was user_input, agents need to respond - not done
                const lastWasUserInput = prevSteps.length > 0 && prevSteps[prevSteps.length - 1].stepType === 'user_input';
                const isWmPreDone = !lastWasUserInput && lastNonUserStep && (lastNonUserStep.stepType === 'finish' || !!lastNonUserStep.finalAnswer);
                const isBlPreDone = !lastWasUserInput && lastNonUserStep && (lastNonUserStep.baseline?.stepType === 'finish' || !!lastNonUserStep.baseline?.finalAnswer);

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

                // Track if we received any result data for this step
                let receivedWatermarkedResult = false;
                let receivedBaselineResult = false;

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
                                            thought: "", action: "", distribution: [], toolDetails: "", stepType: 'tool', isHidden: false
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

                        // Mark that we received a result
                        if (targetAgent === 'watermarked') {
                            receivedWatermarkedResult = true;
                        } else if (targetAgent === 'baseline') {
                            receivedBaselineResult = true;
                        }

                        setLiveScenario(prev => {
                            if (!prev) return null;
                            const steps = [...prev.steps];
                            if (!steps[initialStepIndex]) return prev;

                            const existingStep = steps[initialStepIndex];

                            if (targetAgent === 'watermarked') {
                                // Update Main (Watermarked) Data
                                steps[initialStepIndex] = {
                                    ...existingStep,
                                    stepIndex: stepData.stepIndex !== undefined ? stepData.stepIndex : existingStep.stepIndex,
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
                                const baselineExisting = existingStep.baseline || {
                                    thought: "",
                                    action: "",
                                    distribution: [],
                                    toolDetails: "",
                                    stepType: 'tool' as const,
                                    isHidden: false
                                };
                                // Update Baseline Data
                                steps[initialStepIndex] = {
                                    ...existingStep,
                                    baseline: {
                                        ...baselineExisting,
                                        thought: stepData.thought || baselineExisting.thought || "",
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

                        // Check if task is completed after receiving result
                        setLiveScenario(prev => {
                            if (!prev) return null;
                            const updatedSteps = prev.steps;
                            const getWmDone = () => {
                                for (let i = updatedSteps.length - 1; i >= 0; i--) {
                                    const s = updatedSteps[i];
                                    if (s.stepType === 'user_input') continue;
                                    if (s.isHidden) continue;
                                    return s.stepType === 'finish' || !!s.finalAnswer;
                                }
                                return false;
                            };
                            const getBlDone = () => {
                                for (let i = updatedSteps.length - 1; i >= 0; i--) {
                                    const s = updatedSteps[i];
                                    if (s.stepType === 'user_input') continue;
                                    const b = s.baseline;
                                    if (!b) continue;
                                    if (b.isHidden) continue;
                                    return b.stepType === 'finish' || !!b.finalAnswer;
                                }
                                return false;
                            };
                            const wmDone = getWmDone();
                            const blDone = getBlDone();
                            if (wmDone && blDone) {
                                setIsPlaying(false);
                            }
                            return prev;
                        });
                    }
                });

                // After stream ends, check if placeholder step received any data
                // Only remove it if it's truly empty (no data received from either agent)
                // DO NOT remove steps that have received data, even if task is completed
                setLiveScenario(prev => {
                    if (!prev) return null;
                    const steps = [...prev.steps];
                    const placeholderStep = steps[initialStepIndex];
                    
                    if (placeholderStep) {
                        // Check if this step received any real data
                        // A step has data if it has action, non-placeholder thought, or distribution
                        const hasWatermarkedData = placeholderStep.action || 
                            (placeholderStep.thought && placeholderStep.thought !== "Thinking..." && placeholderStep.thought !== "") ||
                            placeholderStep.distribution.length > 0 ||
                            placeholderStep.stepType === 'finish' ||
                            !!placeholderStep.finalAnswer;
                        
                        const hasBaselineData = placeholderStep.baseline?.action || 
                            (placeholderStep.baseline?.thought && placeholderStep.baseline.thought !== "Thinking..." && placeholderStep.baseline.thought !== "") ||
                            (placeholderStep.baseline?.distribution?.length ?? 0) > 0 ||
                            placeholderStep.baseline?.stepType === 'finish' ||
                            !!placeholderStep.baseline?.finalAnswer;
                        
                        // Only remove if we didn't receive any result AND the step has no data
                        // This means it's a truly empty placeholder that was created but never filled
                        const shouldRemove = !receivedWatermarkedResult && !receivedBaselineResult && 
                            !hasWatermarkedData && !hasBaselineData;
                        
                        if (shouldRemove) {
                            // Remove the invalid placeholder step (only if it's truly empty)
                            steps.splice(initialStepIndex, 1);
                            return {
                                ...prev,
                                totalSteps: steps.length,
                                steps: steps
                            };
                        }
                    }
                    return prev;
                });

                // Auto-save after each step completes
                // Wait a bit for state to update, then save
                setTimeout(async () => {
                    if (sessionId) {
                        try {
                            // Re-fetch the latest liveScenario from state
                            setLiveScenario(currentScenario => {
                                if (!currentScenario) return null;
                                
                                // Save the current state
                                const updatedScenario = {
                                    ...currentScenario,
                                    id: sessionId
                                };
                                
                                // Generate title if needed
                                let titleToSave = updatedScenario.title;
                                if ((!titleToSave.en || titleToSave.en === "Live Session" || titleToSave.en === "New Session" || titleToSave.en === "New Chat") && updatedScenario.steps.length > 0) {
                                    const firstMessage = updatedScenario.userQuery || updatedScenario.steps[0]?.thought || "";
                                    const titlePreview = firstMessage.length > 30 ? firstMessage.substring(0, 30) + '...' : firstMessage;
                                    titleToSave = { en: titlePreview, zh: titlePreview };
                                }
                                
                                // Save to database (fire and forget)
                                api.saveScenario(titleToSave, updatedScenario, sessionId).then(() => {
                                    console.log('[Auto-save] Saved after step completion');
                                }).catch(err => {
                                    console.error('[Auto-save] Failed to save scenario:', err);
                                });
                                
                                return currentScenario; // Return unchanged
                            });
                        } catch (err) {
                            console.error('[Auto-save] Error during save:', err);
                        }
                    }
                }, 500); // Wait 500ms for state updates to complete

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

    // Auto-save effect: Save every 10 seconds if there are changes
    useEffect(() => {
        if (!isLiveMode || !liveScenario || !sessionId || liveScenario.steps.length === 0) {
            return;
        }

        const autoSaveInterval = setInterval(async () => {
            try {
                const updatedScenario = {
                    ...liveScenario,
                    id: sessionId
                };
                
                // Generate title if needed
                let titleToSave = updatedScenario.title;
                if ((!titleToSave.en || titleToSave.en === "Live Session" || titleToSave.en === "New Session" || titleToSave.en === "New Chat") && updatedScenario.steps.length > 0) {
                    const firstMessage = updatedScenario.userQuery || updatedScenario.steps[0]?.thought || "";
                    const titlePreview = firstMessage.length > 30 ? firstMessage.substring(0, 30) + '...' : firstMessage;
                    titleToSave = { en: titlePreview, zh: titlePreview };
                }
                
                await api.saveScenario(titleToSave, updatedScenario, sessionId);
                console.log('[Auto-save] Saved scenario:', sessionId);
            } catch (err) {
                console.error('[Auto-save] Periodic save failed:', err);
            }
        }, 10000); // Save every 10 seconds

        return () => clearInterval(autoSaveInterval);
    }, [isLiveMode, liveScenario, sessionId]);

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
        
        // History View
        isHistoryViewOpen,
        setIsHistoryViewOpen,


        handleContinue: async (prompt: string) => {
            // Case 0: New Session (No Session ID yet - either from welcome page or "New Chat")
            if (!sessionId && isLiveMode) {
                // Initialize Session with this prompt as the custom query
                setIsLoading(true);
                setCustomQuery(prompt);
                try {
                    const data = await api.initCustomSession(apiKey, prompt, payload);

                    const newSessionId = data.sessionId;
                    setSessionId(newSessionId);
                    
                    // Create scenario with prompt as title preview
                    const titlePreview = prompt.length > 30 ? prompt.substring(0, 30) + '...' : prompt;
                    
                    const updatedScenario = {
                        id: newSessionId,
                        title: { en: titlePreview, zh: titlePreview },
                        taskName: "Live Execution",
                        userQuery: data.task.query,
                        totalSteps: 0,
                        steps: []
                    };
                    
                    // If there's an existing "New Chat" entry, update it with the new session ID
                    if (liveScenario && (liveScenario.title.en === "New Chat" || liveScenario.title.zh === "新对话")) {
                        try {
                            // Delete the old "New Chat" entry
                            await api.deleteScenario(liveScenario.id);
                            // Save with the new session ID
                            await api.saveScenario(updatedScenario.title, updatedScenario, newSessionId);
                            await refreshScenarios();
                        } catch (e) {
                            console.error("Failed to update scenario", e);
                        }
                    }
                    
                    setLiveScenario(updatedScenario);
                    setActiveScenarioId(newSessionId);
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
                setIsLoading(true);
                try {
                    const data = await api.restoreSession(apiKey, activeScenarioId);
                    currentSessionId = data.sessionId;
                    setSessionId(currentSessionId);

                    // Ensure liveScenario is synced with the restored session
                    setLiveScenario({ ...activeScenario });
                    setIsLiveMode(true);
                    setCurrentStepIndex(activeScenario.steps.length);
                } catch (e) {
                    console.error("Failed to restore session", e);
                    alert("无法恢复之前的会话。请尝试重新开始。");
                    setIsLoading(false);
                    return;
                } finally {
                    setIsLoading(false);
                }
            }

            // Inject User Step locally for display (Optimistic UI)
            // 1221: Add baseline data for alignment in ComparisonView
            setLiveScenario(prev => {
                if (!prev) return null; // Should not happen if restored above
                const userStep: Step = {
                    stepIndex: prev.steps.length,
                    thought: prompt,
                    action: "",
                    distribution: [],
                    watermark: { bits: "", matrixRows: [], rankContribution: 0 },
                    stepType: 'user_input',
                    // 1221: Ensure user_input has baseline data for alignment
                    baseline: {
                        thought: prompt,
                        action: "",
                        distribution: [],
                        toolDetails: "",
                        stepType: 'user_input'
                    }
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
                // After continuing, the backend resets done state, so we can proceed
                // Set isPlaying to true to enable auto-play, which will trigger handleNext
                setIsPlaying(true);
                
                // Auto-save after user input
                if (liveScenario && currentSessionId) {
                    try {
                        const updatedScenario = {
                            ...liveScenario,
                            id: currentSessionId
                        };
                        
                        // Generate title if needed
                        let titleToSave = updatedScenario.title;
                        if ((!titleToSave.en || titleToSave.en === "Live Session" || titleToSave.en === "New Session" || titleToSave.en === "New Chat") && updatedScenario.steps.length > 0) {
                            const firstMessage = updatedScenario.userQuery || updatedScenario.steps[0]?.thought || prompt;
                            const titlePreview = firstMessage.length > 30 ? firstMessage.substring(0, 30) + '...' : firstMessage;
                            titleToSave = { en: titlePreview, zh: titlePreview };
                        }
                        
                        // Save to database (fire and forget)
                        api.saveScenario(titleToSave, updatedScenario, currentSessionId).catch(err => {
                            console.error('[Auto-save] Failed to save after continue:', err);
                        });
                    } catch (err) {
                        console.error('[Auto-save] Error during continue save:', err);
                    }
                }
            } catch (e) {
                console.error(e);
                alert("Failed to continue session");
            } finally {
                setIsLoading(false);
            }

        },

        handleNewConversation: async () => {
            // Auto Save current if valid (relaxed conditions)
            if (isLiveMode && liveScenario && liveScenario.steps.length > 0) {
                try {
                    // Use sessionId if available, otherwise generate one from liveScenario.id
                    const saveId = sessionId || liveScenario.id;
                    
                    // Generate Title if needed
                    let titleToSave = liveScenario.title;
                    if ((!titleToSave.en || titleToSave.en === "Live Session" || titleToSave.en === "New Session" || titleToSave.en === "New Chat") && liveScenario.steps.length > 0) {
                        try {
                            const res = await api.generateTitle(liveScenario.steps.map(s => ({
                                role: s.stepType === 'user_input' ? 'user' : (s.stepType === 'tool' ? 'tool' : 'assistant'),
                                message: s.thought || s.toolDetails || s.action
                            })));
                            if (res.title) {
                                titleToSave = { en: res.title, zh: res.title };
                            }
                        } catch (err) {
                            // Ignore title generation errors
                        }
                    }
                    
                    // Save with sessionId as the permanent ID
                    await api.saveScenario(titleToSave, {
                        ...liveScenario,
                        id: saveId,
                        title: titleToSave
                    }, saveId);
                    
                    // Wait for database to update
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                    // Refresh history list
                    await refreshScenarios();
                } catch (e) {
                    // Ignore save errors, continue with new conversation
                }
            }

            // Create new empty conversation with unique ID
            const newChatId = `new_${Date.now()}`;
            const newEmptyScenario: Trajectory = {
                id: newChatId,
                title: { en: "New Chat", zh: "新对话" },
                taskName: "New Chat",
                userQuery: "",
                totalSteps: 0,
                steps: []
            };
            
            // Immediately save the empty conversation to database
            try {
                await api.saveScenario(newEmptyScenario.title, newEmptyScenario, newChatId);
                // Force refresh scenarios
                await refreshScenarios();
                // Small delay to ensure state updates
                await new Promise(resolve => setTimeout(resolve, 50));
            } catch (e) {
                console.error("Failed to create new chat", e);
                alert("创建新对话失败，请重试");
                return;
            }

            // Reset for New Conversation (Stay in Live Mode)
            setIsPlaying(false);
            setCurrentStepIndex(0);
            setErasedIndices(new Set());
            setSessionId(null); // Clear sessionId - will be created when user sends first message
            setCustomQuery("");
            
            setLiveScenario(newEmptyScenario);
            setActiveScenarioId(newChatId);
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
            // Check if we have an active scenario
            if (!activeScenarioId || !activeScenario || activeScenario.steps.length === 0) {
                alert(language === 'zh' ? '没有可评估的对话' : 'No conversation to evaluate');
                return;
            }

            if (evaluationResult) {
                setIsEvaluationModalOpen(true);
                return;
            }

            setIsEvaluating(true);
            setIsEvaluationModalOpen(true);
            
            try {
                // ALWAYS restore session for evaluation to ensure fresh session with both agents' data
                console.log('[Evaluate] Active scenarioId:', activeScenarioId);
                console.log('[Evaluate] Active scenario:', activeScenario);
                console.log('[Evaluate] API Key:', apiKey ? 'Present' : 'Missing');
                console.log('[Evaluate] Restoring session for evaluation...');
                
                let currentSessionId: string;
                try {
                    const data = await api.restoreSession(apiKey, activeScenarioId);
                    currentSessionId = data.sessionId;
                    setSessionId(currentSessionId);
                    console.log('[Evaluate] Session restored successfully:', currentSessionId);
                    console.log('[Evaluate] Restored data:', data);
                    
                    // Wait a bit for session to be fully initialized
                    await new Promise(resolve => setTimeout(resolve, 200));
                } catch (restoreError: any) {
                    console.error('[Evaluate] Failed to restore session:', restoreError);
                    console.error('[Evaluate] Error response:', restoreError.response);
                    const errMsg = restoreError.response?.data?.detail || restoreError.message;
                    throw new Error(`Failed to restore session: ${errMsg}`);
                }

                console.log('[Evaluate] Evaluating session:', currentSessionId);
                const result = await api.evaluateSession(currentSessionId, language);
                console.log('[Evaluate] Evaluation result:', result);
                setEvaluationResult(result);

                // Update liveScenario to persist this result in memory for now
                if (liveScenario && activeScenarioId === liveScenario.id) {
                    setLiveScenario(prev => prev ? ({ ...prev, evaluation: result }) : null);
                }

                // Also update savedScenarios if it exists there
                setSavedScenarios(prev => prev.map(s =>
                    s.id === activeScenarioId ? { ...s, evaluation: result } : s
                ));
                
                // Refresh scenarios from database to ensure evaluation is persisted
                await refreshScenarios();

            } catch (e: any) {
                console.error("Evaluation failed", e);
                const errorMsg = e.response?.data?.detail || e.message || "Unknown error";
                alert(`Evaluation failed: ${errorMsg}\n\nPlease make sure:\n1. The conversation has completed steps\n2. Both agents have responses\n3. The backend server is running`);
                setIsEvaluationModalOpen(false); // Close on error
            } finally {
                setIsEvaluating(false);
            }
        },

        deleteScenario: async (scenarioId: string) => {
            try {
                await api.deleteScenario(scenarioId);
                
                // If deleting current scenario, switch to another one
                if (activeScenarioId === scenarioId) {
                    // Find another scenario to switch to
                    const remaining = savedScenarios.filter(s => s.id !== scenarioId);
                    if (remaining.length > 0) {
                        setActiveScenarioId(remaining[0].id);
                    } else {
                        // No scenarios left, create a new one
                        const newSessionId = `sess_${Date.now()}_new`;
                        const newEmptyScenario: Trajectory = {
                            id: newSessionId,
                            title: { en: "New Chat", zh: "新对话" },
                            taskName: "New Chat",
                            userQuery: "",
                            totalSteps: 0,
                            steps: []
                        };
                        setLiveScenario(newEmptyScenario);
                        setActiveScenarioId(newSessionId);
                    }
                }
                
                // Refresh scenarios list
                await refreshScenarios();
            } catch (e) {
                console.error("Delete failed", e);
                alert("删除失败，请重试");
            }
        }
    };
};