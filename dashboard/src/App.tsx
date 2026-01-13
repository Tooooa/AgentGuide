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
import EvaluationModal from './components/execution/EvaluationModal';
import TutorialTooltip from './components/tutorial/TutorialTooltip';
import { useSimulation } from './hooks/useSimulation';
import { I18nProvider, useI18n } from './i18n/I18nContext';

function AppContent() {
  const { locale } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  
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
  
  // 新手引导状态 - 每次刷新页面后都会出现一次
  const [hasCompletedTutorial, setHasCompletedTutorial] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(1);
  
  // 引导目标元素的ref
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const channelNoiseRef = useRef<HTMLDivElement>(null);
  const modeToggleRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<HTMLInputElement>(null);

  // Filter scenarios based on search query
  const filteredScenarios = useMemo(() => {
    if (!searchQuery.trim()) {
      return scenarios;
    }
    const query = searchQuery.toLowerCase();
    return scenarios.filter(scenario => {
      const titleEn = scenario.title.en?.toLowerCase() || '';
      const titleZh = scenario.title.zh?.toLowerCase() || '';
      const userQuery = scenario.userQuery?.toLowerCase() || '';
      return titleEn.includes(query) || titleZh.includes(query) || userQuery.includes(query);
    });
  }, [scenarios, searchQuery]);

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

  const handleNewConversation = useCallback(async () => {
    // 1. Auto-Save & Reset via Hook
    await startNewConversation();
    // 2. Stay on Dashboard (do not reset hasStarted)
    // setHasStarted(false); // REMOVED
  }, [startNewConversation]);

  // 处理新手引导下一步
  const handleTutorialNext = () => {
    if (tutorialStep < 4) {
      setTutorialStep(tutorialStep + 1);
    } else {
      // 教程完成，在当前会话中标记完成（刷新页面后会重置）
      setShowTutorial(false);
      setTutorialStep(1);
      setHasCompletedTutorial(true);
    }
  };

  // 获取当前步骤的目标ref
  const getCurrentTutorialRef = () => {
    switch (tutorialStep) {
      case 1: return settingsButtonRef;
      case 2: return channelNoiseRef;
      case 3: return modeToggleRef;
      case 4: return promptInputRef;
      default: return null;
    }
  };

  // 初次进入主页面时自动弹出设置窗口
  useEffect(() => {
    if (hasStarted && isFirstEntry) {
      // 使用 setTimeout 避免 React 同步状态更新的警告
      setTimeout(() => {
        setIsSettingsModalOpen(true);
        setIsFirstEntry(false);
      }, 0);
    }
  }, [hasStarted, isFirstEntry]);

  // 当设置窗口关闭时，如果是首次进入且未完成教程，则启动新手引导
  useEffect(() => {
    if (!isSettingsModalOpen && !isFirstEntry && !hasCompletedTutorial && !showTutorial && tutorialStep === 1) {
      // 等待设置窗口关闭动画完成后再启动引导
      setTimeout(() => {
        setShowTutorial(true);
      }, 500);
    }
  }, [isSettingsModalOpen, isFirstEntry, hasCompletedTutorial, showTutorial, tutorialStep]);

  // 移除自动初始化逻辑，由用户在设置中明确点击“应用”来启动会话
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
      
      // Tutorial ref
      modeToggleRef={modeToggleRef}
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
                      userQuery={customQuery || activeScenario.userQuery}
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
                      targetPayload={payload}
                      erasureRate={erasureRate}
                      setErasureRate={setErasureRate}
                      channelNoiseRef={channelNoiseRef}
                    />
                  }
                  onHome={() => {
                    setHasStarted(false);
                    handleReset();
                  }}
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
          isLiveMode={isLiveMode}
          onToggleLiveMode={() => setIsLiveMode(!isLiveMode)}
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
        />

        {/* 新手引导 */}
        <TutorialTooltip
          isOpen={showTutorial}
          step={tutorialStep}
          totalSteps={4}
          onNext={handleTutorialNext}
          targetRef={getCurrentTutorialRef()}
        />

        {/* Full Screen History View Modal */}
        {isHistoryViewOpen && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[80vh] flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b">
                <h2 className="text-2xl font-bold text-gray-800">
                  {locale === 'zh' ? '历史记录' : 'History'}
                </h2>
                <button
                  onClick={() => setIsHistoryViewOpen(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  title={locale === 'zh' ? '关闭' : 'Close'}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Search Bar */}
              <div className="px-6 pt-4 pb-2">
                <div className="relative">
                  <input
                    type="text"
                    placeholder={locale === 'zh' ? '搜索对话...' : 'Search conversations...'}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <svg 
                    className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredScenarios.map((scenario) => (
                    <div
                      key={scenario.id}
                      className={`p-4 rounded-lg border-2 cursor-pointer transition-all hover:shadow-lg ${
                        scenario.id === activeScenarioId
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-blue-300'
                      }`}
                      onClick={() => {
                        setActiveScenarioId(scenario.id);
                        setIsHistoryViewOpen(false);
                      }}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="font-semibold text-gray-800 flex-1 line-clamp-2">
                          {locale === 'zh' ? scenario.title.zh : scenario.title.en}
                        </h3>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(locale === 'zh' ? '确定要删除这条记录吗？' : 'Delete this conversation?')) {
                              deleteScenario(scenario.id);
                            }
                          }}
                          className="ml-2 p-1 hover:bg-red-50 rounded transition-colors"
                          title={locale === 'zh' ? '删除' : 'Delete'}
                        >
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                      <p className="text-sm text-gray-500 line-clamp-2 mb-2">
                        {scenario.userQuery || (locale === 'zh' ? '暂无内容' : 'No content')}
                      </p>
                      <div className="flex items-center justify-between text-xs text-gray-400">
                        <span>{scenario.totalSteps} {locale === 'zh' ? '步' : 'steps'}</span>
                        {scenario.id === activeScenarioId && (
                          <span className="text-blue-500 font-medium">
                            {locale === 'zh' ? '当前' : 'Active'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
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
