import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import MainLayout from './components/layout/MainLayout';
import ControlPanel from './components/controls/ControlPanel';
import FlowFeed from './components/execution/FlowFeed';
import DecoderPanel from './components/decoder/DecoderPanel';
import ComparisonView from './components/layout/ComparisonView';
import WelcomeScreen from './components/layout/WelcomeScreen';
import SaveScenarioModal from './components/modals/SaveScenarioModal';
import SettingsModal from './components/modals/SettingsModal';
import EvaluationModal from './components/execution/EvaluationModal';
import { useSimulation } from './hooks/useSimulation';
import { I18nProvider } from './i18n/I18nContext';

function App() {
  const {
    scenarios,
    activeScenario,
    activeScenarioId,
    setActiveScenarioId,
    refreshScenarios, // New
    isPlaying,
    setIsPlaying,
    currentStepIndex,
    erasureRate,
    setErasureRate,
    erasedIndices,
    handleReset,
    handleNext,
    handlePrev,
    visibleSteps,
    isLiveMode,
    setIsLiveMode,
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

    // Comparison
    isComparisonMode,
    setIsComparisonMode
  } = useSimulation();

  const [hasStarted, setHasStarted] = useState(false);
  // const [isComparisonMode, setIsComparisonMode] = useState(false); // Removed
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isFirstEntry, setIsFirstEntry] = useState(true);


  // NOTE: targetPayload is now redundant if we use hook's payload?
  // But DecoderPanel uses it. Let's keep using hook's payload for consistency
  // or sync them.
  // Actually, let's just use the hook's payload directly for DecoderPanel too, 
  // but DecoderPanel prop is 'targetPayload'.

  const handleStart = (config: { scenarioId: string; payload: string; erasureRate: number; query?: string }) => {
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

  // 初次进入主页面时自动弹出设置窗口
  useEffect(() => {
    if (hasStarted && isFirstEntry) {
      setIsSettingsModalOpen(true);
      setIsFirstEntry(false);
    }
  }, [hasStarted, isFirstEntry]);

  const handleNewConversation = async () => {
    // 1. Auto-Save & Reset via Hook
    await startNewConversation();
    // 2. Stay on Dashboard (do not reset hasStarted)
    // setHasStarted(false); // REMOVED
  };

  // Auto-Start Effect for Custom Queries
  useEffect(() => {
    if (hasStarted && isLiveMode && customQuery && !sessionId) {
      handleInitSession();
    }
  }, [hasStarted, isLiveMode, customQuery, sessionId, handleInitSession]);

  // Stats Calculation
  let liveStats = undefined;
  if (activeScenario && activeScenario.steps.length > 0) {
    const metricsSteps = activeScenario.steps.filter(s => s.metrics);
    if (metricsSteps.length > 0) {
      const totalLat = metricsSteps.reduce((sum, s) => sum + (s.metrics?.latency || 0), 0);
      const totalTok = metricsSteps.reduce((sum, s) => sum + (s.metrics?.tokens || 0), 0);
      // Latency in ms (from seconds)
      // Tokens/sec = totalTokens / totalTime
      liveStats = {
        avgLatency: parseFloat((totalLat * 1000 / metricsSteps.length).toFixed(2)),
        avgTokens: totalLat > 0 ? parseFloat((totalTok / totalLat).toFixed(0)) : 0
      };
    }
  }

  const commonControlPanel = (
    <ControlPanel
      scenarios={scenarios}
      activeScenarioId={activeScenarioId}
      onSelectScenario={setActiveScenarioId}
      isPlaying={isPlaying}
      onTogglePlay={() => setIsPlaying(!isPlaying)}
      onReset={handleReset}
      onNext={handleNext}
      onPrev={handlePrev}
      erasureRate={erasureRate}
      setErasureRate={setErasureRate}
      currentStep={currentStepIndex}
      totalSteps={activeScenario.totalSteps}
      isLiveMode={isLiveMode}
      onToggleLiveMode={() => setIsLiveMode(!isLiveMode)}
      apiKey={apiKey}
      setApiKey={setApiKey}
      onInitSession={handleInitSession}
      isComparisonMode={isComparisonMode}
      onToggleComparisonMode={() => setIsComparisonMode(!isComparisonMode)}
      liveStats={liveStats}
      currentScenario={activeScenario}
      onNew={handleNewConversation}
      onSave={() => setIsSaveModalOpen(true)}

      // Evaluation
      onEvaluate={evaluateSession}
      isEvaluating={isEvaluating}
      evaluationResult={evaluationResult}
    />
  );

  return (
    <I18nProvider>
      <div className="bg-slate-50 min-h-screen">
        <AnimatePresence mode='wait'>
          {!hasStarted ? (
            <WelcomeScreen
              key="welcome"
              onStart={handleStart}
              initialScenarioId={activeScenarioId}
              initialErasureRate={erasureRate}
              isLiveMode={isLiveMode}
              onToggleLiveMode={() => setIsLiveMode(!isLiveMode)}
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
                      evaluationResult={evaluationResult}
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
                      userQuery={activeScenario.userQuery}
                      onContinue={handleContinue}
                      isPlaying={isPlaying}
                      onTogglePlay={() => setIsPlaying(!isPlaying)}
                      scenarioId={activeScenario.id}
                    />
                  }
                  right={
                    <DecoderPanel
                      visibleSteps={visibleSteps}
                      erasedIndices={erasedIndices}
                      targetPayload={payload}
                      erasureRate={erasureRate}
                      setErasureRate={setErasureRate}
                    />
                  }
                  onHome={() => {
                    setHasStarted(false);
                    handleReset();
                  }}
                  onSettings={() => setIsSettingsModalOpen(true)}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <SettingsModal
          isOpen={isSettingsModalOpen}
          onClose={() => setIsSettingsModalOpen(false)}
          isLiveMode={isLiveMode}
          onToggleLiveMode={() => setIsLiveMode(!isLiveMode)}
          apiKey={apiKey}
          setApiKey={setApiKey}
          customQuery={customQuery}
          setCustomQuery={setCustomQuery}
          payload={payload}
          setPayload={setPayload}
          onInitSession={handleInitSession}
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
        />
      </div>
    </I18nProvider>
  );
}

export default App;
