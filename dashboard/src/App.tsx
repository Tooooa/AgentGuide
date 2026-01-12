import { useState, useEffect, useMemo, useCallback } from 'react';
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
import { I18nProvider, useI18n } from './i18n/I18nContext';
import { api } from './services/api';

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

    // Delete
    deleteScenario,
    
    // History View
    isHistoryViewOpen,
    setIsHistoryViewOpen,

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

  const handleStart = async (config: { scenarioId: string; payload: string; erasureRate: number; query?: string }) => {
    setPayload(config.payload);
    setErasureRate(config.erasureRate);
    
    // If it's a new conversation (has query), create it immediately
    if (config.query) {
      setCustomQuery(config.query);
      
      // Create new conversation in database
      const newSessionId = `sess_${Date.now()}_new`;
      const titlePreview = config.query.length > 30 ? config.query.substring(0, 30) + '...' : config.query;
      
      try {
        await api.saveScenario(
          { en: titlePreview, zh: titlePreview },
          {
            id: newSessionId,
            title: { en: titlePreview, zh: titlePreview },
            taskName: "New Chat",
            userQuery: config.query,
            totalSteps: 0,
            steps: []
          },
          newSessionId
        );
        
        await refreshScenarios();
        setActiveScenarioId(newSessionId);
      } catch (e) {
        console.error("Failed to create conversation", e);
        setActiveScenarioId(config.scenarioId);
      }
    } else {
      setCustomQuery("");
      setActiveScenarioId(config.scenarioId);
    }
    
    setHasStarted(true);
  };

  const handleNewConversation = useCallback(async () => {
    // 1. Auto-Save & Reset via Hook
    await startNewConversation();
    // 2. Stay on Dashboard (do not reset hasStarted)
    // setHasStarted(false); // REMOVED
  }, [startNewConversation]);

  // 初次进入主页面时自动弹出设置窗口
  useEffect(() => {
    if (hasStarted && isFirstEntry) {
      setIsSettingsModalOpen(true);
      setIsFirstEntry(false);
    }
  }, [hasStarted, isFirstEntry]);

  // Auto-Start Effect for Custom Queries
  useEffect(() => {
    if (hasStarted && isLiveMode && customQuery && !sessionId) {
      handleInitSession();
    }
  }, [hasStarted, isLiveMode, customQuery, sessionId, handleInitSession]);

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
      onRefreshHistory={refreshScenarios}
      onDeleteScenario={deleteScenario}
      setIsHistoryViewOpen={setIsHistoryViewOpen}

      // Evaluation
      onEvaluate={evaluateSession}
      isEvaluating={isEvaluating}
      evaluationResult={evaluationResult}
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
                onHome={async () => {
                  // Save current conversation before going home
                  if (isLiveMode && activeScenario && activeScenario.steps.length > 0 && sessionId) {
                    try {
                      await handleNewConversation();
                    } catch (e) {
                      console.error("Failed to save before home", e);
                    }
                  }
                  setHasStarted(false);
                  handleReset();
                }}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
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
                      userQuery={customQuery || activeScenario.userQuery}
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
      
      {/* Full Screen History View */}
      {isHistoryViewOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-slate-800">
                {locale === 'zh' ? '全部历史记录' : 'All History'}
              </h2>
              <button
                onClick={() => setIsHistoryViewOpen(false)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <svg className="w-6 h-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {/* Search Box */}
            <div className="px-6 pt-4 pb-2">
              <div className="relative">
                <input
                  type="text"
                  placeholder={locale === 'zh' ? '搜索对话...' : 'Search conversations...'}
                  className="w-full px-4 py-3 pl-12 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
                  onChange={(e) => {
                    const searchTerm = e.target.value.toLowerCase();
                    const historyGrid = e.target.closest('.bg-white')?.querySelector('.grid');
                    if (historyGrid) {
                      const items = historyGrid.querySelectorAll('button');
                      items.forEach((item: any) => {
                        const text = item.textContent?.toLowerCase() || '';
                        item.style.display = text.includes(searchTerm) ? '' : 'none';
                      });
                    }
                  }}
                />
                <svg className="w-5 h-5 absolute left-4 top-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
            
            {/* History List */}
            <div className="flex-1 overflow-y-auto p-6 pt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {scenarios.map((s) => {
                  const timestampMatch = s.id.match(/sess_(\d+)_/);
                  let timeStr = '';
                  if (timestampMatch) {
                    const timestamp = parseInt(timestampMatch[1]) * 1000;
                    const date = new Date(timestamp);
                    timeStr = date.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US');
                  }
                  
                  return (
                    <button
                      key={s.id}
                      onClick={() => {
                        setActiveScenarioId(s.id);
                        setIsHistoryViewOpen(false);
                      }}
                      className={`p-4 rounded-xl border-2 transition-all text-left ${
                        activeScenarioId === s.id
                          ? 'border-indigo-500 bg-indigo-50'
                          : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className="font-semibold text-slate-800 line-clamp-2">
                          {locale === 'zh' ? (s.title.zh || s.title.en) : s.title.en}
                        </h3>
                        {deleteScenario && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(locale === 'zh' ? '确定要删除这条对话吗？' : 'Delete this conversation?')) {
                                deleteScenario(s.id);
                              }
                            }}
                            className="p-1 hover:bg-red-50 rounded transition-all flex-shrink-0"
                          >
                            <svg className="w-4 h-4 text-slate-400 hover:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                      <p className="text-sm text-slate-500 line-clamp-2 mb-2">
                        {s.userQuery || (locale === 'zh' ? '暂无内容' : 'No content')}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-slate-400">
                        <span>{s.steps.length} turns</span>
                        {timeStr && (
                          <>
                            <span>•</span>
                            <span>{timeStr}</span>
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              
              {scenarios.length === 0 && (
                <div className="text-center py-12 text-slate-400">
                  {locale === 'zh' ? '暂无历史记录' : 'No history yet'}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
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
