import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Box, Cpu, Plus, Search, Zap } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import AddAgentModal from '../modals/AddAgentModal';
import { api } from '../../services/api';
import { scenarios as presetScenarios } from '../../data/mockData';
import type { Trajectory } from '../../data/mockData';

interface WelcomeScreenProps {
    onStart: (config: { scenarioId: string; payload: string; erasureRate: number; query?: string }) => void;
    initialScenarioId: string;
    initialErasureRate: number;
    isLiveMode: boolean;
    onToggleLiveMode: () => void;
    apiKey: string;
    setApiKey: (key: string) => void;
}

type Mode = 'tool' | 'self' | 'add' | null;

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
    onStart,
    initialErasureRate,
    isLiveMode,
    onToggleLiveMode,
    apiKey,
    setApiKey
}) => {
    const { locale } = useI18n();
    const [selectedMode, setSelectedMode] = useState<Mode>(null);
    const [isAddAgentModalOpen, setIsAddAgentModalOpen] = useState(false);
    const [addAgentRepoUrl, setAddAgentRepoUrl] = useState('');

    // Config State
    const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');
    const [promptText, setPromptText] = useState('');
    const [showScenarioList, setShowScenarioList] = useState(false);
    const [historyScenarios, setHistoryScenarios] = useState<Trajectory[]>([]);

    const [payload, setPayload] = useState('1101');
    const [erasureRate] = useState(initialErasureRate);

    // Combine preset scenarios with history
    const allScenarios = useMemo(() => {
        return [...presetScenarios, ...historyScenarios];
    }, [historyScenarios]);

    // Load scenarios from database
    useEffect(() => {
        const loadScenarios = async () => {
            try {
                const saved = await api.listScenarios();
                setHistoryScenarios(saved);
            } catch (e) {
                console.error("Failed to load scenarios", e);
            }
        };
        loadScenarios();
    }, []);

    const [activeIndex, setActiveIndex] = useState(1);
    const containerRef = useRef<HTMLDivElement>(null);

    const modes = [
        { id: 'self', title: 'Self model', icon: Cpu, desc: 'Internal reasoning model' },
        { id: 'tool', title: 'Tool use', icon: Box, desc: 'Agent uses external tools' },
        { id: 'add', title: 'Add your agent', icon: Plus, desc: 'Custom agent integration' },
    ];

    const handleWheel = (e: React.WheelEvent) => {
        // Prevent scrolling if we are editing text inputs, but here we are on the container
        if (selectedMode === 'tool') return; // If tool is expanded (configuration mode), disable wheel nav

        if (e.deltaY > 0) {
            setActiveIndex(prev => Math.min(prev + 1, modes.length - 1));
        } else {
            setActiveIndex(prev => Math.max(prev - 1, 0));
        }
    };

    // Effect to auto-select mode based on active index, but only if not already in a specific mode (optional)
    useEffect(() => {
        // When scrolling, we can optionally auto-select the mode or wait for click
        // For now, let's just keep 'tool' expansion manual, but 'self' and 'add' visual selection syncs
        if (selectedMode !== 'tool') {
            // Maybe we don't want to auto-set selectedMode as it triggers expansions?
            // Let's keep separation: activeIndex is for "highlight/focus", click is for "select/expand"
        }
    }, [activeIndex, selectedMode]);

    const handleSelectScenario = (s: Trajectory) => {
        setSelectedScenarioId(s.id);
        const title = locale === 'zh' ? s.title.zh : s.title.en;
        setPromptText(s.userQuery || title);
        setShowScenarioList(false);
    };

    const handleToolUseClick = () => {
        if (selectedMode === 'tool') {
            onStart({
                scenarioId: '',
                payload: payload,
                erasureRate: erasureRate,
                query: ''
            });
        }
    };
    
    const handleAddAgentApply = (data: { repoUrl: string; apiKey: string }) => {
        setApiKey(data.apiKey);
        setAddAgentRepoUrl(data.repoUrl);
        setIsAddAgentModalOpen(false);
        onStart({
            scenarioId: '',
            payload,
            erasureRate,
            mode: 'add_agent',
            agentRepoUrl: data.repoUrl
        });
    };

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8 font-sans relative overflow-hidden">
            {/* Background elements */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-indigo-200/20 rounded-full blur-3xl" />
                <div className="absolute top-[40%] -right-[10%] w-[40%] h-[60%] bg-blue-200/20 rounded-full blur-3xl" />
            </div>

            {/* Main Container */}
            <div className="w-full max-w-7xl flex items-center justify-between gap-8 relative z-10 h-[800px]">
                {/* Left Side - Logo and Text */}
                <motion.div
                    initial={{ opacity: 0, x: -50 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.6 }}
                    className="flex-shrink-0 w-[400px] flex flex-col justify-center"
                >
                    <div className="flex flex-col items-start mb-6">
                        <img src="/logo.svg" alt="AgentMark Logo" className="h-48 opacity-90 drop-shadow-sm mb-4" style={{ backgroundColor: 'transparent' }} />
                        <img src="/logo_1.svg" alt="AgentMark Logo Text" className="h-24 opacity-90 drop-shadow-sm" style={{ backgroundColor: 'transparent' }} />
                    </div>
                    <p className="text-slate-600 text-xl font-medium tracking-wide mt-6 whitespace-nowrap">
                        a utility-preserving watermark for agents
                    </p>
                </motion.div>

                {/* Right Side - Scrollable Selection Layer */}
                <div
                    id="right-side-container"
                    ref={containerRef}
                    className="flex-1 h-full relative"
                    onWheel={handleWheel}
                >
                    {/* Artistic Background Layer */}
                    <div
                        className="absolute inset-y-0 right-0 w-[120%] bg-white/40 backdrop-blur-xl shadow-2xl z-0 border-l border-white/50"
                        style={{
                            borderRadius: '50% 0 0 50% / 100% 0 0 100%', // Large arc shape
                            left: '22%'
                        }}
                    />

                    {/* Scrollable Items Container Wrapper for Vertically Centering Active Item */}
                    <div
                        className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none"
                        style={{ clipPath: 'inset(0 -100% 0 0)' }}
                    >
                        <motion.div
                            className="flex flex-col items-start gap-12 pointer-events-auto pl-[26rem] relative"
                            animate={{
                                y: (1 - activeIndex) * 200 // Shift entire list to keep active item centered. 200 is approx step height
                            }}
                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        >
                            {modes.map((mode, index) => {
                                const isActive = index === activeIndex;
                                const isSelected = selectedMode === mode.id;

                                // Base dimensions
                                const baseWidth = '420px';
                                const activeWidth = '520px'; // 扩大
                                const expandedWidth = '620px'; // Tool use expanded

                                const baseHeight = '140px'; // 扩大
                                const activeHeight = '160px'; // 扩大
                                const expandedHeight = '650px'; // Tool use expanded

                                return (
                                    <motion.div
                                        key={mode.id}
                                        layout
                                        initial={false}
                                        animate={{
                                            scale: isActive ? 1.05 : 0.85,
                                            opacity: isActive ? 1 : 0.4,
                                            x: isActive ? 0 : 40, // Non-active items pushed slightly right
                                            width: isSelected && mode.id === 'tool' ? expandedWidth : (isActive ? activeWidth : baseWidth),
                                            height: isSelected && mode.id === 'tool' ? expandedHeight : (isActive ? activeHeight : baseHeight)
                                        }}
                                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                        className={`
                                            relative rounded-[2rem] transition-colors duration-300
                                            ${isSelected || isActive ? 'bg-white shadow-xl ring-1 ring-white/60' : 'bg-white/60 hover:bg-white/80'}
                                            ${isSelected && mode.id === 'tool' ? 'z-50' : 'z-10'}
                                        `}
                                        style={{
                                            transformOrigin: 'center left'
                                        }}
                                        onClick={() => {
                                            if (mode.id === 'tool') {
                                                // 直接跳转到主页面，不展开配置
                                                onStart({
                                                    scenarioId: '',
                                                    payload: payload,
                                                    erasureRate: erasureRate,
                                                    query: ''
                                                });
                                            } else if (mode.id === 'add') {
                                                setActiveIndex(index);
                                                setSelectedMode(mode.id as Mode);
                                                setIsAddAgentModalOpen(true);
                                            } else {
                                                setActiveIndex(index);
                                                setSelectedMode(mode.id as Mode);
                                            }
                                        }}
                                    >
                                        {/* Content */}
                                        {isSelected && mode.id === 'tool' ? (
                                            <div className="h-full p-8 flex flex-col cursor-default" onClick={e => e.stopPropagation()}>
                                                {/* Header */}
                                                <div className="flex items-center justify-between mb-8">
                                                    <h2 className="text-3xl font-bold text-slate-900">Configuration</h2>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedMode(null);
                                                        }}
                                                        className="text-slate-400 hover:text-slate-600 text-3xl leading-none"
                                                    >
                                                        ×
                                                    </button>
                                                </div>

                                                <div className="flex-1 space-y-6 overflow-y-auto pr-2 custom-scrollbar">
                                                    {/* API Key */}
                                                    <div>
                                                        <label className="block text-base font-bold text-slate-700 mb-3">DeepSeek API Key</label>
                                                        <input
                                                            type="password"
                                                            value={apiKey}
                                                            onChange={(e) => setApiKey(e.target.value)}
                                                            placeholder="sk-..."
                                                            className="w-full px-5 py-4 rounded-2xl border border-slate-200 focus:border-indigo-500 outline-none transition-all text-base font-mono bg-slate-50/50"
                                                        />
                                                    </div>

                                                    {/* Prompt */}
                                                    <div>
                                                        <label className="block text-base font-bold text-slate-700 mb-3">Prompt</label>
                                                        <div className="relative">
                                                            <Search className="absolute left-5 top-4 text-slate-400" size={20} />
                                                            <input
                                                                type="text"
                                                                value={promptText}
                                                                onChange={(e) => setPromptText(e.target.value)}
                                                                onFocus={() => setShowScenarioList(true)}
                                                                placeholder={locale === 'zh' ? "输入您的请求..." : "Enter your query..."}
                                                                className="w-full pl-12 pr-5 py-4 rounded-2xl border border-slate-200 focus:border-indigo-500 outline-none transition-all text-base bg-slate-50/50"
                                                            />

                                                            {/* Dropdown */}
                                                            <AnimatePresence>
                                                                {showScenarioList && (
                                                                    <motion.div
                                                                        initial={{ opacity: 0, y: 5 }}
                                                                        animate={{ opacity: 1, y: 0 }}
                                                                        exit={{ opacity: 0, y: 5 }}
                                                                        className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl border border-slate-100 shadow-2xl overflow-hidden z-[60]"
                                                                    >
                                                                        <div className="max-h-60 overflow-y-auto">
                                                                            {presetScenarios.length > 0 && (
                                                                                <>
                                                                                    <div className="px-5 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider bg-slate-50">
                                                                                        {locale === 'zh' ? '预设场景' : 'Preset Scenarios'}
                                                                                    </div>
                                                                                    {presetScenarios.map(s => (
                                                                                        <button
                                                                                            key={s.id}
                                                                                            onClick={(e) => {
                                                                                                e.stopPropagation();
                                                                                                handleSelectScenario(s);
                                                                                            }}
                                                                                            className="w-full text-left px-5 py-4 hover:bg-indigo-50 text-sm transition-colors"
                                                                                        >
                                                                                            {locale === 'zh' ? s.title.zh : s.title.en}
                                                                                        </button>
                                                                                    ))}
                                                                                </>
                                                                            )}
                                                                        </div>
                                                                    </motion.div>
                                                                )}
                                                            </AnimatePresence>
                                                        </div>
                                                        {showScenarioList && <div className="fixed inset-0 z-40" onClick={() => setShowScenarioList(false)} />}
                                                    </div>

                                                    {/* Payload */}
                                                    <div>
                                                        <label className="block text-base font-bold text-slate-700 mb-3">Payload Content</label>
                                                        <input
                                                            type="text"
                                                            value={payload}
                                                            onChange={(e) => setPayload(e.target.value)}
                                                            className="w-full px-5 py-4 rounded-2xl border border-slate-200 focus:border-indigo-500 outline-none transition-all text-base bg-slate-50/50"
                                                        />
                                                    </div>
                                                </div>

                                                {/* Footer */}
                                                <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-100">
                                                    <div className="flex gap-2 bg-slate-100 p-1.5 rounded-xl">
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); isLiveMode && onToggleLiveMode(); }}
                                                            className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${!isLiveMode ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                                        >
                                                            Simulation
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); !isLiveMode && onToggleLiveMode(); }}
                                                            className={`flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${isLiveMode ? 'bg-rose-500 text-white shadow-md' : 'text-slate-500 hover:text-slate-700'}`}
                                                        >
                                                            <Zap size={16} fill="currentColor" /> Live
                                                        </button>
                                                    </div>

                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleToolUseClick(); }}
                                                        className="px-8 py-3 rounded-xl font-bold text-base bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-lg flex items-center gap-2 hover:shadow-xl hover:translate-y-[-1px] transition-all"
                                                    >
                                                        Start <ArrowRight size={18} />
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="h-full flex items-center p-8 cursor-pointer gap-8 absolute inset-0">
                                                <div className={`
                                                    p-6 rounded-3xl flex-shrink-0 shadow-sm transition-colors duration-300
                                                    ${isActive ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-400'}
                                                `}>
                                                    <mode.icon size={isActive ? 42 : 32} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h3 className={`font-bold truncate transition-all duration-300 ${isActive ? 'text-2xl text-slate-900 mb-2' : 'text-xl text-slate-500 mb-1'}`}>
                                                        {mode.title}
                                                    </h3>
                                                    <p className={`text-base truncate transition-all duration-300 ${isActive ? 'text-slate-600' : 'text-slate-400'}`}>{mode.desc}</p>
                                                </div>
                                                {isActive && (
                                                    <div className={`text-indigo-600 transition-opacity duration-300 ${isActive ? 'opacity-100' : 'opacity-0'}`}>
                                                        <ArrowRight size={28} />
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </motion.div>
                                );
                            })}
                        </motion.div>
                    </div>
                </div>
            </div>
            <AddAgentModal
                isOpen={isAddAgentModalOpen}
                onClose={() => setIsAddAgentModalOpen(false)}
                onApply={handleAddAgentApply}
                apiKey={apiKey}
                repoUrl={addAgentRepoUrl}
            />
        </div>
    );
};

export default WelcomeScreen;
