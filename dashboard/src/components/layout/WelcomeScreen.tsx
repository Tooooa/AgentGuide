import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Box, Cpu, Plus, CheckCircle2, ChevronDown, Search } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { scenarios } from '../../data/mockData';

interface WelcomeScreenProps {
    onStart: (config: { scenarioId: string; payload: string; erasureRate: number }) => void;
    initialScenarioId: string;
    initialErasureRate: number;
}

type Mode = 'tool' | 'self' | 'add' | null;

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onStart, initialScenarioId, initialErasureRate }) => {
    const { locale } = useI18n();
    const [selectedMode, setSelectedMode] = useState<Mode>(null);

    // Config State
    const [selectedScenarioId, setSelectedScenarioId] = useState<string>(''); // Start empty
    const [promptText, setPromptText] = useState('');
    const [showScenarioList, setShowScenarioList] = useState(false);

    const [payload, setPayload] = useState('AgentMark');
    const [erasureRate, setErasureRate] = useState(initialErasureRate);

    const modes = [
        { id: 'tool', title: 'Tool use', icon: Box, desc: 'Agent uses external tools' },
        { id: 'self', title: 'Self model', icon: Cpu, desc: 'Internal reasoning model' },
        { id: 'add', title: 'Add your agent', icon: Plus, desc: 'Custom agent integration' },
    ];

    const handleSelectScenario = (s: typeof scenarios[0]) => {
        setSelectedScenarioId(s.id);
        const title = locale === 'zh' ? s.title.zh : s.title.en;
        setPromptText(s.userQuery || title);
        setShowScenarioList(false);
    };

    const isFlipped = selectedMode === 'tool';

    return (
        <div 
            className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 font-sans relative overflow-hidden"
        >
            {/* Click outside handler */}
            {isFlipped && (
                <div 
                    className="fixed inset-0 z-40 bg-white/10 backdrop-blur-sm transition-all"
                    onClick={() => setSelectedMode(null)}
                />
            )}

            {/* Background elements */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-indigo-200/20 rounded-full blur-3xl" />
                <div className="absolute top-[40%] -right-[10%] w-[40%] h-[60%] bg-blue-200/20 rounded-full blur-3xl" />
            </div>

            {/* Header */}
            <motion.div
                // Removed conditional opacity/y animation to keep header visible
                initial={{ opacity: 1, y: 0 }}
                className="text-center mb-12 relative z-10 pointer-events-none"
            >
                <h1 className="text-5xl font-extrabold text-slate-900 mb-4 tracking-tight">AgentMark</h1>
                <p className="text-slate-500 text-xl font-medium">Robust Watermarking for LLM Agents</p>
            </motion.div>

            {/* Main Container - Flexbox for robust alignment */}
            <div className="w-full max-w-7xl flex items-center justify-center gap-6 relative z-50 h-[600px] perspective-1000">
                <AnimatePresence>
                    {modes.map((mode) => {
                        const isToolCard = mode.id === 'tool';
                        const isActive = selectedMode === mode.id;

                        return (
                            <motion.div
                                key={mode.id}
                                layout
                                initial={false}
                                animate={{ 
                                    width: isActive ? 700 : 256,
                                    height: isActive ? 450 : 320,
                                    opacity: 1, // Always visible
                                    scale: 1,   // Always strictly 1
                                }}
                                transition={{ type: "spring", stiffness: 200, damping: 25 }}
                                onClick={() => !isActive && setSelectedMode(mode.id as Mode)}
                                className={`relative rounded-3xl bg-white shadow-xl ${
                                    isActive ? 'cursor-default' : 'cursor-pointer hover:shadow-2xl hover:-translate-y-1'
                                } transition-shadow overflow-visible`}
                                style={{ 
                                    // Make sure non-active cards are still interactive if we want them to be switchable? 
                                    // User flow: Click Tool -> It expands. Click Self -> Tool closes, Self expands? 
                                    // For now, let's allow switching.
                                    display: 'block',
                                    zIndex: isActive ? 50 : 10 // Active on top
                                }}
                            >
                                {/* 3D Flipper Container */}
                                <motion.div
                                    className="w-full h-full relative"
                                    animate={{ rotateY: isActive && isToolCard ? 180 : 0 }} // Only flip if it is the Tool Card AND it is active
                                    transition={{ type: "spring", stiffness: 260, damping: 20 }}
                                    style={{ transformStyle: 'preserve-3d' }}
                                >
                                    {/* FRONT FACE */}
                                    <div 
                                        className="absolute inset-0 w-full h-full bg-white rounded-3xl border border-slate-200 flex flex-col items-center justify-center text-center p-6"
                                        style={{ 
                                            backfaceVisibility: 'hidden', 
                                            WebkitBackfaceVisibility: 'hidden',
                                            zIndex: isActive ? 0 : 1 
                                        }}
                                    >
                                        <div className={`p-5 rounded-2xl mb-6 ${isActive ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-50 text-slate-600'}`}>
                                            <mode.icon size={40} />
                                        </div>
                                        <h3 className="text-2xl font-bold text-slate-800 mb-3">{mode.title}</h3>
                                        <p className="text-slate-400">{mode.desc}</p>
                                        {isToolCard && (
                                            <div className="mt-8 text-indigo-600 font-medium text-sm flex items-center gap-1 opacity-0 hover:opacity-100 transition-opacity">
                                                Configure <ArrowRight size={16} />
                                            </div>
                                        )}
                                    </div>

                                    {/* BACK FACE (Only for Tool Card) */}
                                    {isToolCard && (
                                        <div 
                                            className="absolute inset-0 w-full h-full bg-white rounded-3xl border border-indigo-100 shadow-inner p-8 flex flex-col"
                                            style={{ 
                                                backfaceVisibility: 'hidden', 
                                                WebkitBackfaceVisibility: 'hidden',
                                                transform: 'rotateY(180deg)',
                                                zIndex: isActive ? 1 : 0
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            {/* Header */}
                                            <div className="flex items-center gap-3 mb-6">
                                                <span className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-bold">02</span>
                                                <h2 className="text-xl font-bold text-slate-900">Configuration</h2>
                                            </div>

                                            {/* Form */}
                                            <div className="flex-1 space-y-6">
                                                {/* Prompt */}
                                                <div>
                                                    <label className="block text-sm font-bold text-slate-700 mb-2">Prompt</label>
                                                    <div className="relative group z-20">
                                                        <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
                                                        <input
                                                            type="text"
                                                            value={promptText}
                                                            onChange={(e) => setPromptText(e.target.value)}
                                                            onFocus={() => setShowScenarioList(true)}
                                                            placeholder="输入您的请求或选择场景..."
                                                            className="w-full pl-11 pr-10 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 outline-none transition-all text-sm"
                                                        />
                                                        {/* Dropdown */}
                                                        <AnimatePresence>
                                                            {showScenarioList && (
                                                                <motion.div
                                                                    initial={{ opacity: 0, y: 5 }}
                                                                    animate={{ opacity: 1, y: 0 }}
                                                                    exit={{ opacity: 0, y: 5 }}
                                                                    className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl border border-slate-100 shadow-xl overflow-hidden z-20 text-left"
                                                                >
                                                                    <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                                                        {scenarios.map(s => (
                                                                            <button
                                                                                key={s.id}
                                                                                onClick={() => handleSelectScenario(s)}
                                                                                className="w-full text-left px-4 py-3 hover:bg-indigo-50 flex items-center justify-between group/item"
                                                                            >
                                                                                <span className="text-sm font-medium text-slate-700 group-hover/item:text-indigo-700">
                                                                                    {locale === 'zh' ? s.title.zh : s.title.en}
                                                                                </span>
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                </motion.div>
                                                            )}
                                                        </AnimatePresence>
                                                        {showScenarioList && <div className="fixed inset-0 z-10" onClick={() => setShowScenarioList(false)} />}
                                                    </div>
                                                </div>

                                                {/* Payload & Loss Rate */}
                                                <div className="grid grid-cols-[1fr_1.5fr] gap-8 items-start">
                                                    <div>
                                                        <label className="block text-sm font-bold text-slate-700 mb-2">Payload Content</label>
                                                        <input
                                                            type="text"
                                                            value={payload}
                                                            onChange={(e) => setPayload(e.target.value)}
                                                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 outline-none transition-all text-sm"
                                                        />
                                                    </div>
                                                    <div>
                                                        <div className="flex justify-between mb-2">
                                                            <label className="text-sm font-bold text-slate-700">Loss Rate: {erasureRate}%</label>
                                                        </div>
                                                        <div className="relative h-2 bg-slate-100 rounded-full mt-4">
                                                            <div 
                                                                className="absolute h-full bg-indigo-100 rounded-full" 
                                                                style={{ width: '100%' }}
                                                            />
                                                            <input
                                                                type="range"
                                                                min="0" max="50" step="5"
                                                                value={erasureRate}
                                                                onChange={(e) => setErasureRate(Number(e.target.value))}
                                                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                                            />
                                                            <div 
                                                                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-indigo-600 rounded-full pointer-events-none shadow-md transition-all"
                                                                style={{ left: `${(erasureRate / 50) * 100}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Footer */}
                                            <div className="flex justify-end mt-8 pt-4 border-t border-slate-50">
                                                <button
                                                    onClick={() => onStart({ scenarioId: selectedScenarioId || scenarios[0].id, payload, erasureRate })}
                                                    className={`px-8 py-3 rounded-xl font-bold text-base shadow-sm flex items-center gap-2 transition-all transform hover:-translate-y-0.5
                                                        ${selectedScenarioId || promptText
                                                            ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-indigo-200'
                                                            : 'bg-slate-100 text-slate-300 cursor-not-allowed'}`}
                                                    disabled={!selectedScenarioId && !promptText}
                                                >
                                                    Proceed to Dashboard <ArrowRight size={18} />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </motion.div>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>
        </div>
    );
};
export default WelcomeScreen;
