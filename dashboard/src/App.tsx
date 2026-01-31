import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import MainLayout from './components/layout/MainLayout';
import ControlPanel from './components/controls/ControlPanel';
import FlowFeed from './components/execution/FlowFeed';
import DecoderPanel from './components/decoder/DecoderPanel';
import ComparisonView from './components/layout/ComparisonView';
import WelcomeScreen from './components/layout/WelcomeScreen';

import SaveScenarioModal from './components/modals/SaveScenarioModal';
import SettingsModal from './components/modals/SettingsModal';
import HistoryModal from './components/modals/HistoryModal';
import EvaluationModal from './components/execution/EvaluationModal';
import TutorialTooltip from './components/tutorial/TutorialTooltip';
import { useSimulation } from './hooks/useSimulation';
import { I18nProvider, useI18n } from './i18n/I18nContext';

function AppContent() {
  const { locale } = useI18n();

  const {
    scenarios,
    activeScenario,
    activeScenarioId,
    setActiveScenarioId,
    refreshScenarios, // New
    isPlaying,
    setIsPlaying,
    erasureRate,
    setErasureRate,
    erasedIndices,
    handleReset,
    visibleSteps,



    // isLiveMode, // Removed
    // setIsLiveMode, // Removed
    handleInitSession,
    setCustomQuery,
    setApiKey,
    customQuery,
    sessionId,
    apiKey, // Add back
    payload, // from hook
    setPayload, // from hook
    handleContinue, // from hook
    handleNewConversation: startNewConversation,

    // Evaluation
    evaluateSession,
    isEvaluating,
    evaluationResult,
    isEvaluationModalOpen,
    setIsEvaluationModalOpen,
    evaluationError, // New

    // Delete
    deleteScenario,
    clearAllHistory,
    batchDeleteScenarios,
    togglePin,

    // History View
    isHistoryViewOpen,
    setIsHistoryViewOpen,

    // Comparison
    isComparisonMode,
    setIsComparisonMode
  } = useSimulation();

  const [hasStarted, setHasStarted] = useState(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isFirstEntry, setIsFirstEntry] = useState(true);

  // Tutorial state - read from localStorage
  const [hasCompletedTutorial, setHasCompletedTutorial] = useState(() => {
    return localStorage.getItem('agentmark_tutorial_completed') === 'true';
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(1);

  // Compare mode tutorial state - read from localStorage
  const [hasCompletedCompareTutorial, setHasCompletedCompareTutorial] = useState(() => {
    return localStorage.getItem('agentmark_compare_tutorial_completed') === 'true';
  });
  const [showCompareTutorial, setShowCompareTutorial] = useState(false);
  const [compareTutorialStep, setCompareTutorialStep] = useState(1);

  const handleHome = useCallback(() => {
    setHasStarted(false);
    handleReset();
  }, [handleReset]);

  // Refs for tutorial target elements
  const settingsButtonRef = useRef<HTMLButtonElement>(null!);
  const channelNoiseRef = useRef<HTMLDivElement>(null!);
  const modeToggleRef = useRef<HTMLDivElement>(null!);
  const promptInputRef = useRef<HTMLInputElement>(null!);
  const decoderProgressRef = useRef<HTMLDivElement>(null!);

  // Compare mode tutorial refs
  const evaluationRef = useRef<HTMLDivElement>(null!);
  const utilityMonitorRef = useRef<HTMLDivElement>(null!);
  const chartRef = useRef<HTMLDivElement>(null!);


  // NOTE: targetPayload is now redundant if we use hook's payload?
  // But DecoderPanel uses it. Let's keep using hook's payload for consistency
  // or sync them.
  // Actually, let's just use the hook's payload directly for DecoderPanel too, 
  // but DecoderPanel prop is 'targetPayload'.



  const handleStart = (config: { scenarioId: string; payload: string; erasureRate: number; query?: string; agentRepoUrl?: string }) => {
    setActiveScenarioId(config.scenarioId);
    if (config.query) {
      setCustomQuery(config.query);
    } else {
      setCustomQuery(""); // Reset if not custom
    }
    setPayload(config.payload); // Sync to hook
    setErasureRate(config.erasureRate);

    // Note: setHasStarted logic will trigger the effect below
    setHasStarted(true);
  };

  const handleNewConversation = useCallback(async () => {
    // Create a new conversation directly; the hook handles whether to save the current one internally
    await startNewConversation();
  }, [startNewConversation]);

  // Handle tutorial next step
  const handleTutorialNext = () => {
    if (tutorialStep < 4) {
      setTutorialStep(tutorialStep + 1);
    } else {
      // Tutorial completed, save persisted state
      setShowTutorial(false);
      setTutorialStep(1);
      setHasCompletedTutorial(true);
      localStorage.setItem('agentmark_tutorial_completed', 'true');
    }
  };

  // Handle tutorial skip
  const handleTutorialSkip = () => {
    setShowTutorial(false);
    setTutorialStep(1);
    setHasCompletedTutorial(true);
    localStorage.setItem('agentmark_tutorial_completed', 'true');
  };

  // Get target ref for current step
  const getCurrentTutorialRef = () => {
    switch (tutorialStep) {
      case 1: return settingsButtonRef;
      case 2: return channelNoiseRef;
      case 3: return modeToggleRef;
      case 4: return promptInputRef;
      default: return null;
    }
  };

  // Handle Compare mode tutorial next step
  const handleCompareTutorialNext = () => {
    if (compareTutorialStep < 3) {
      setCompareTutorialStep(compareTutorialStep + 1);
    } else {
      setShowCompareTutorial(false);
      setCompareTutorialStep(1);
      setHasCompletedCompareTutorial(true);
      localStorage.setItem('agentmark_compare_tutorial_completed', 'true');
    }
  };

  // Handle Compare mode tutorial skip
  const handleCompareTutorialSkip = () => {
    setShowCompareTutorial(false);
    setHasCompletedCompareTutorial(true);
    localStorage.setItem('agentmark_compare_tutorial_completed', 'true');
  };

  // Get target ref for current step in Compare mode
  const getCurrentCompareTutorialRef = () => {
    switch (compareTutorialStep) {
      case 1: return evaluationRef;
      case 2: return utilityMonitorRef;
      case 3: return chartRef;
      default: return null;
    }
  };

  // Automatically popup settings window on first entry to main page
  useEffect(() => {
    if (!hasStarted) {
      return;
    }
    if (isFirstEntry) {
      // Use setTimeout to avoid React synchronous state update warnings
      setTimeout(() => {
        setIsSettingsModalOpen(true);
        setIsFirstEntry(false);
      }, 0);
    }
  }, [hasStarted, isFirstEntry]);

  // Start tutorial if settings modal closes, it's first entry, and tutorial not completed
  useEffect(() => {
    if (hasStarted && !isSettingsModalOpen && !isFirstEntry && !hasCompletedTutorial && !showTutorial && tutorialStep === 1) {
      // Wait for settings modal close animation before starting tutorial
      setTimeout(() => {
        setShowTutorial(true);
      }, 500);
    }
  }, [isSettingsModalOpen, isFirstEntry, hasCompletedTutorial, showTutorial, tutorialStep]);

  // Start Compare tutorial when switching to Comparison Mode for the first time (only if active conversation exists)
  useEffect(() => {
    const hasActiveConversation = !!sessionId || (activeScenario.steps && activeScenario.steps.length > 0);
    if (isComparisonMode && hasActiveConversation && !hasCompletedCompareTutorial && !showCompareTutorial && compareTutorialStep === 1) {
      setTimeout(() => {
        setShowCompareTutorial(true);
      }, 500);
    }
  }, [isComparisonMode, sessionId, activeScenario.steps, hasCompletedCompareTutorial, showCompareTutorial, compareTutorialStep]);


  // Remove auto-init logic; user must explicitly click "Apply" in settings to start session
  // useEffect(() => {
  //   if (hasStarted && isLiveMode && customQuery && !sessionId) {
  //     handleInitSession();
  //   }
  // }, [hasStarted, isLiveMode, customQuery, sessionId, handleInitSession]);

  const liveStats = useMemo(() => {
    if (activeScenario && activeScenario.steps.length > 0) {
      const metricsSteps = activeScenario.steps.filter(s => s.metrics);
      if (metricsSteps.length > 0) {
        const totalLat = metricsSteps.reduce((sum, s) => sum + (s.metrics?.latency || 0), 0);
        const totalTok = metricsSteps.reduce((sum, s) => sum + (s.metrics?.tokens || 0), 0);
        // Latency in ms (from seconds)
        // Tokens/sec = totalTokens / totalTime
        return {
          avgLatency: parseFloat((totalLat * 1000 / metricsSteps.length).toFixed(2)),
          avgTokens: totalLat > 0 ? parseFloat((totalTok / totalLat).toFixed(0)) : 0
        };
      }
    }
    return undefined;
  }, [activeScenario]);

  const commonControlPanel = (
    <ControlPanel
      scenarios={scenarios}
      activeScenarioId={activeScenarioId}
      onSelectScenario={setActiveScenarioId}

      isComparisonMode={isComparisonMode}
      onToggleComparisonMode={() => setIsComparisonMode(!isComparisonMode)}
      liveStats={liveStats}
      currentScenario={activeScenario}
      onNew={handleNewConversation}

      onRefreshHistory={refreshScenarios}
      onDeleteScenario={deleteScenario}
      setIsHistoryViewOpen={setIsHistoryViewOpen}

      // Evaluation
      onEvaluate={evaluateSession}
      isEvaluating={isEvaluating}
      evaluationResult={evaluationResult}

      // Tutorial ref
      modeToggleRef={modeToggleRef}
      utilityMonitorRef={utilityMonitorRef}
      chartRef={chartRef}
    />
  );

  return (
    <div className="bg-slate-50 min-h-screen">
      <AnimatePresence mode='wait'>
        {!hasStarted ? (
          <WelcomeScreen
            key="welcome"
            onStart={handleStart}
            initialScenarioId={activeScenarioId}
            initialErasureRate={erasureRate}

            // isLiveMode={isLiveMode}
            // onToggleLiveMode={() => setIsLiveMode(!isLiveMode)}
            apiKey={apiKey}
            setApiKey={setApiKey}
          />
        ) : (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="h-screen overflow-hidden"
          >
            {isComparisonMode ? (
              // Comparison Mode Layout
              <div className="h-full p-4 grid grid-cols-[340px_1fr] gap-6 overflow-hidden max-w-[1920px] mx-auto">
                <div className="h-full overflow-hidden">
                  {commonControlPanel}
                </div>
                <div className="h-full overflow-hidden">
                  <ComparisonView
                    visibleSteps={visibleSteps}
                    erasedIndices={erasedIndices}
                    scenarioId={activeScenario.id}
                    userQuery={customQuery || activeScenario.userQuery}
                    evaluationRef={evaluationRef}
                    chartRef={chartRef}
                  />
                </div>
              </div>
            ) : (
              // Standard Dashboard Layout
              <MainLayout
                left={commonControlPanel}
                middle={
                  <FlowFeed
                    visibleSteps={visibleSteps}
                    erasedIndices={erasedIndices}
                    userQuery={customQuery || activeScenario.userQuery}
                    onContinue={handleContinue}
                    isPlaying={isPlaying}
                    onTogglePlay={() => setIsPlaying(!isPlaying)}
                    scenarioId={activeScenario.id}
                    promptInputRef={promptInputRef}
                  />
                }
                right={
                  <DecoderPanel
                    visibleSteps={visibleSteps}
                    erasedIndices={erasedIndices}
                    targetPayload={activeScenario?.payload || payload}
                    erasureRate={erasureRate}
                    setErasureRate={setErasureRate}
                    channelNoiseRef={channelNoiseRef}
                    decoderProgressRef={decoderProgressRef}
                    promptInputRef={promptInputRef}
                  />
                }
                onHome={handleHome}
                onSettings={() => setIsSettingsModalOpen(true)}
                settingsButtonRef={settingsButtonRef}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}

        // isLiveMode={isLiveMode}
        // onToggleLiveMode={() => setIsLiveMode(!isLiveMode)}
        apiKey={apiKey}
        setApiKey={setApiKey}
        customQuery={customQuery}
        setCustomQuery={setCustomQuery}
        payload={payload}
        setPayload={setPayload}
        onInitSession={handleInitSession}
        hasActiveConversation={!!sessionId || (activeScenario.steps && activeScenario.steps.length > 0)}
      />

      <SaveScenarioModal
        isOpen={isSaveModalOpen}
        onClose={() => setIsSaveModalOpen(false)}
        scenarioData={activeScenario}
        onSaved={() => {
          refreshScenarios();
          // Optional: maybe confirm to user
        }}
      />

      <EvaluationModal
        isOpen={isEvaluationModalOpen}
        onClose={() => setIsEvaluationModalOpen(false)}
        result={evaluationResult}
        isLoading={isEvaluating}
        onReEvaluate={() => evaluateSession(locale, true)}
        error={evaluationError} // New
      />

      {/* Tutorial */}
      <TutorialTooltip
        isOpen={showTutorial}
        step={tutorialStep}
        totalSteps={4}
        onNext={handleTutorialNext}
        onSkip={handleTutorialSkip}
        targetRef={getCurrentTutorialRef()}
      />

      {/* Compare Mode Tutorial */}
      <TutorialTooltip
        isOpen={showCompareTutorial}
        step={compareTutorialStep}
        totalSteps={3}
        onNext={handleCompareTutorialNext}
        onSkip={handleCompareTutorialSkip}
        targetRef={getCurrentCompareTutorialRef()}
        mode="compare"
      />

      {/* Full Screen History View Modal */}
      <HistoryModal
        isOpen={isHistoryViewOpen}
        onClose={() => setIsHistoryViewOpen(false)}
        scenarios={scenarios}
        activeScenarioId={activeScenarioId}
        onSelectScenario={setActiveScenarioId}
        onDeleteScenario={deleteScenario}
        onClearAllHistory={clearAllHistory}
        onBatchDeleteScenarios={batchDeleteScenarios}
        onTogglePin={togglePin}
      />


    </div>
  );
}

function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}

export default App;