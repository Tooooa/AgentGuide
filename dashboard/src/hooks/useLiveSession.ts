import { useState, useRef, useEffect, useCallback } from 'react';
import type { Trajectory, Step } from '../types';
import { api } from '../services/api';

export interface UseLiveSessionReturn {
    apiKey: string;
    setApiKey: React.Dispatch<React.SetStateAction<string>>;
    sessionId: string | null;
    setSessionId: React.Dispatch<React.SetStateAction<string | null>>;
    liveScenario: Trajectory | null;
    setLiveScenario: React.Dispatch<React.SetStateAction<Trajectory | null>>;
    isLoading: boolean;
    setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
    isPlaying: boolean;
    setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
    currentStepIndex: number;
    setCurrentStepIndex: React.Dispatch<React.SetStateAction<number>>;
    handleInitSession: () => Promise<void>;
    handleNext: () => Promise<void>;
    handlePrev: () => void;
    handleReset: () => void;
    handleContinue: (prompt: string) => Promise<void>;
    handleNewConversation: () => Promise<void>;
    customQuery: string;
    setCustomQuery: React.Dispatch<React.SetStateAction<string>>;
    payload: string;
    setPayload: React.Dispatch<React.SetStateAction<string>>;
}

export const useLiveSession = (
    activeScenarioId: string,
    setActiveScenarioId: React.Dispatch<React.SetStateAction<string>>,
    refreshScenarios: () => Promise<void>
): UseLiveSessionReturn => {
    const defaultApiKey = (import.meta as any)?.env?.DEEPSEEK_API_KEY || "";
    const [apiKey, setApiKey] = useState(defaultApiKey);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [liveScenario, setLiveScenario] = useState<Trajectory | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [customQuery, setCustomQuery] = useState<string>("");
    const [payload, setPayload] = useState<string>("1101");

    const timerRef = useRef<number | null>(null);

    const handleReset = useCallback(() => {
        setIsPlaying(false);
        setCurrentStepIndex(0);
        setSessionId(null);
        setLiveScenario(null);
        setCustomQuery("");
    }, []);

    // Live Session Init
    const handleInitSession = useCallback(async () => {
        if (!apiKey) return;
        setIsLoading(true);
        try {
            let data;
            if (customQuery) {
                data = await api.initCustomSession(apiKey, customQuery, payload);
            } else {
                console.warn("Simulation mode is deprecated");
                setIsLoading(false);
                return;
            }

            setSessionId(data.sessionId);
            setActiveScenarioId(data.sessionId);
            setLiveScenario({
                id: data.task.id,
                title: { en: "Live Session", zh: "实时会话" },
                taskName: "Live Execution",
                userQuery: data.task.query,
                totalSteps: 0,
                steps: [],
                payload: payload
            });
            setCurrentStepIndex(0);
            setIsPlaying(true);
        } catch (e) {
            console.error(e);
            alert("Failed to init session");
        } finally {
            setIsLoading(false);
        }
    }, [apiKey, customQuery, payload, setActiveScenarioId]);

    const handleNext = useCallback(async () => {
        if (!sessionId || !liveScenario) return;

        // Check Termination Condition
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

        setIsLoading(true);
        try {
            const initialStepIndex = liveScenario.steps.length;
            let currentThought = "";
            let currentBaselineThought = "";

            const prevSteps = liveScenario.steps;
            const lastNonUserStep = [...prevSteps].reverse().find(s => s.stepType !== 'user_input');
            const lastWasUserInput = prevSteps.length > 0 && prevSteps[prevSteps.length - 1].stepType === 'user_input';
            const isWmPreDone = !lastWasUserInput && lastNonUserStep && (lastNonUserStep.stepType === 'finish' || !!lastNonUserStep.finalAnswer);
            const isBlPreDone = !lastWasUserInput && lastNonUserStep && (lastNonUserStep.baseline?.stepType === 'finish' || !!lastNonUserStep.baseline?.finalAnswer);

            setLiveScenario(prev => {
                if (!prev) return null;
                const placeholderStep: Step = {
                    stepIndex: initialStepIndex,
                    timestamp: new Date().toLocaleTimeString('en-GB'),
                    thought: isWmPreDone ? "" : "Thinking...",
                    action: "",
                    distribution: [],
                    watermark: { bits: "", matrixRows: [], rankContribution: 0 },
                    stepType: isWmPreDone ? 'tool' : 'tool',
                    toolDetails: "",
                    isHidden: isWmPreDone,
                    baseline: {
                        thought: isBlPreDone ? "" : "Thinking...",
                        action: "",
                        distribution: [],
                        toolDetails: "",
                        stepType: isBlPreDone ? 'tool' : 'tool',
                        isHidden: isBlPreDone
                    }
                };
                return {
                    ...prev,
                    totalSteps: prev.steps.length + 1,
                    steps: [...prev.steps, placeholderStep]
                };
            });

            setCurrentStepIndex(prev => prev + 1);

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
                    const targetAgent = stepData.agent || 'watermarked';

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
                            steps[initialStepIndex] = {
                                ...existingStep,
                                stepIndex: initialStepIndex,
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
                }
            });

            setLiveScenario(prev => {
                if (!prev) return null;
                const steps = [...prev.steps];
                const placeholderStep = steps[initialStepIndex];

                if (placeholderStep) {
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

                    const shouldRemove = !receivedWatermarkedResult && !receivedBaselineResult &&
                        !hasWatermarkedData && !hasBaselineData;

                    if (shouldRemove) {
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

            setTimeout(() => {
                if (sessionId) {
                    setLiveScenario(currentScenario => {
                        if (!currentScenario) return null;
                        const updatedScenario = { ...currentScenario, id: sessionId };

                        let titleToSave = updatedScenario.title;
                        if ((!titleToSave.en || titleToSave.en === "Live Session" || titleToSave.en === "New Session" || titleToSave.en === "New Chat") && updatedScenario.steps.length > 0) {
                            const firstMessage = updatedScenario.userQuery || updatedScenario.steps[0]?.thought || "";
                            const titlePreview = firstMessage.length > 30 ? firstMessage.substring(0, 30) + '...' : firstMessage;
                            titleToSave = { en: titlePreview, zh: titlePreview };
                        }

                        api.saveScenario(titleToSave, updatedScenario, sessionId).catch(err => {
                            console.error('[Auto-save] Failed to save scenario:', err);
                        });

                        return currentScenario;
                    });
                }
            }, 500);

        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    }, [sessionId, liveScenario]);

    const handlePrev = useCallback(() => {
        if (currentStepIndex > 0) {
            setCurrentStepIndex(prev => prev - 1);
        }
    }, [currentStepIndex]);

    const handleContinue = async (prompt: string) => {
        if (!sessionId) {
            // New Session
            setIsLoading(true);
            setCustomQuery(prompt);
            try {
                const data = await api.initCustomSession(apiKey, prompt, payload);
                const newSessionId = data.sessionId;
                setSessionId(newSessionId);

                const titlePreview = prompt.length > 30 ? prompt.substring(0, 30) + '...' : prompt;
                const updatedScenario: Trajectory = {
                    id: newSessionId,
                    title: { en: titlePreview, zh: titlePreview },
                    taskName: "Live Execution",
                    userQuery: data.task.query,
                    totalSteps: 0,
                    steps: [],
                    payload: payload
                };

                // Remove temporary "New Chat" if exists
                if (liveScenario && (liveScenario.title.en === "New Chat" || liveScenario.title.zh === "新对话")) {
                    if (liveScenario.id.startsWith('sess_')) {
                        try {
                            await api.deleteScenario(liveScenario.id);
                        } catch (e) { }
                    }
                }

                await api.saveScenario(updatedScenario.title, updatedScenario, newSessionId);
                await refreshScenarios();

                setLiveScenario(updatedScenario);
                setActiveScenarioId(newSessionId);
                setCurrentStepIndex(0);
                setIsPlaying(true);
            } catch (e) {
                console.error(e);
                alert("Failed to start new session");
            } finally {
                setIsLoading(false);
            }
            return;
        }

        // Existing Session
        let currentSessionId = sessionId;
        if (!currentSessionId || currentSessionId !== activeScenarioId) {
            setIsLoading(true);
            try {
                const data = await api.restoreSession(apiKey, activeScenarioId);
                currentSessionId = data.sessionId;
                setSessionId(currentSessionId);
                // Need to sync liveScenario? Assuming activeScenario is correct for now
                // But better to use what we restored immediately if needed, or rely on activeScenario which should be synced
                setCurrentStepIndex(prev => prev); // keep current
            } catch (e) {
                console.error("Failed to restore session", e);
                alert("无法恢复之前的会话。请尝试重新开始。");
                setIsLoading(false);
                return;
            } finally {
                setIsLoading(false);
            }
        }

        setLiveScenario(prev => {
            if (!prev) return null;
            const userStep: Step = {
                stepIndex: prev.steps.length,
                timestamp: new Date().toLocaleTimeString('en-GB'),
                thought: prompt,
                action: "",
                distribution: [],
                watermark: { bits: "", matrixRows: [], rankContribution: 0 },
                stepType: 'user_input',
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
            setIsPlaying(true);

            if (liveScenario && currentSessionId) {
                const updatedScenario = { ...liveScenario, id: currentSessionId };
                api.saveScenario(updatedScenario.title, updatedScenario, currentSessionId).catch(console.error);
            }
        } catch (e: any) {
            if (e.response?.status === 404) {
                try {
                    const restoreData = await api.restoreSession(apiKey, activeScenarioId);
                    const restoredSessionId = restoreData.sessionId;
                    setSessionId(restoredSessionId);
                    await api.continueSession(restoredSessionId, prompt);
                    setIsPlaying(true);
                } catch (retryError) {
                    alert("Failed to restore and continue session");
                }
            } else {
                alert("Failed to continue session");
            }
        } finally {
            setIsLoading(false);
        }
    };


    const handleNewConversation = useCallback(async () => {
        if (liveScenario && liveScenario.steps.length > 0) {
            try {
                const saveId = sessionId || liveScenario.id;
                let titleToSave = liveScenario.title;
                if ((!titleToSave.en || titleToSave.en === "Live Session" || titleToSave.en === "New Session") && liveScenario.steps.length > 0) {
                    try {
                        const res = await api.generateTitle(liveScenario.steps.map(s => ({
                            role: s.stepType === 'user_input' ? 'user' : (s.stepType === 'tool' ? 'tool' : 'assistant'),
                            message: s.thought || s.toolDetails || s.action
                        })));
                        if (res.title) titleToSave = { en: res.title, zh: res.title };
                    } catch (err) { }
                }
                await api.saveScenario(titleToSave, { ...liveScenario, id: saveId, title: titleToSave }, saveId);
                await refreshScenarios();
            } catch (e) { }
        }

        const newChatId = `new_${Date.now()}`;
        const newEmptyScenario: Trajectory = {
            id: newChatId,
            title: { en: "New Chat", zh: "新对话" },
            taskName: "New Chat",
            userQuery: "",
            totalSteps: 0,
            steps: []
        };

        setIsPlaying(false);
        setCurrentStepIndex(0);
        setSessionId(null);
        setCustomQuery("");
        setLiveScenario(newEmptyScenario);
        setActiveScenarioId(newChatId);
    }, [liveScenario, sessionId, refreshScenarios, setActiveScenarioId]);


    // Timer Logic
    useEffect(() => {
        if (isPlaying) {
            timerRef.current = window.setInterval(async () => {
                if (isLoading) return;
                await handleNext();
            }, 2000);
        } else {
            if (timerRef.current) clearInterval(timerRef.current);
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [isPlaying, isLoading, handleNext]);

    // Auto-save effect
    useEffect(() => {
        if (!liveScenario || !sessionId || liveScenario.steps.length === 0) return;
        const autoSaveInterval = setInterval(async () => {
            // ... existing auto save logic ...
            // Simplified for brevity, relying on post-step saves mostly
        }, 10000);
        return () => clearInterval(autoSaveInterval);
    }, [liveScenario, sessionId]);

    return {
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
    };
};
