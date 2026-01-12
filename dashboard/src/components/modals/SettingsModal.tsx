import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Zap } from 'lucide-react';
import { scenarios } from '../../data/mockData';
import { useI18n } from '../../i18n/I18nContext';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    isLiveMode: boolean;
    onToggleLiveMode: () => void;
    apiKey: string;
    setApiKey: (key: string) => void;
    customQuery: string;
    setCustomQuery: (query: string) => void;
    payload: string;
    setPayload: (payload: string) => void;
    onInitSession?: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
    isOpen,
    onClose,
    isLiveMode,
    onToggleLiveMode,
    apiKey,
    setApiKey,
    customQuery,
    setCustomQuery,
    payload,
    setPayload,
    onInitSession
}) => {
    const { locale } = useI18n();
    const [showScenarioList, setShowScenarioList] = useState(false);

    const handleSelectScenario = (s: typeof scenarios[0]) => {
        const title = locale === 'zh' ? s.title.zh : s.title.en;
        setCustomQuery(s.userQuery || title);
        setShowScenarioList(false);
    };

    const handleApply = () => {
        if (onInitSession && isLiveMode) {
            onInitSession();
        }
        onClose();
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[100]"
                    />

                    {/* Modal Container */}
                    <div 
                        className="fixed z-[101]"
                        style={{ 
                            top: '50%', 
                            left: '50%', 
                            transform: 'translate(-50%, -50%)' 
                        }}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ type: "spring", duration: 0.3 }}
                            className="w-[45vw] min-w-[600px] max-w-[900px] bg-white rounded-2xl shadow-2xl overflow-hidden"
                            onClick={(e) => e.stopPropagation()}
                        >
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-indigo-600 to-violet-600">
                            <h2 className="text-xl font-bold text-white">Settings</h2>
                            <button
                                onClick={onClose}
                                className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
                            >
                                <X size={20} className="text-white" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
                            {/* Mode Switcher */}
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-3">Mode</label>
                                <div className="flex gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200 w-full">
                                    <button
                                        onClick={() => isLiveMode && onToggleLiveMode()}
                                        className={`flex-1 flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold tracking-wide transition-all ${!isLiveMode ? 'bg-white text-slate-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-600'
                                            }`}
                                    >
                                        Simulation
                                    </button>
                                    <button
                                        onClick={() => !isLiveMode && onToggleLiveMode()}
                                        className={`flex-1 flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold tracking-wide transition-all ${isLiveMode ? 'bg-rose-500 text-white shadow-md shadow-rose-200' : 'text-slate-400 hover:text-slate-600'
                                            }`}
                                    >
                                        <Zap size={16} fill="currentColor" /> Live Mode
                                    </button>
                                </div>
                            </div>

                            {/* API Key */}
                            {isLiveMode && (
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-2">DeepSeek API Key</label>
                                    <input
                                        type="password"
                                        value={apiKey}
                                        onChange={(e) => setApiKey(e.target.value)}
                                        placeholder="sk-..."
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 outline-none transition-all text-sm font-mono"
                                    />
                                </div>
                            )}

                            {/* Payload */}
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">
                                    {locale === 'zh' ? '载荷内容' : 'Payload Content'}
                                </label>
                                <input
                                    type="text"
                                    value={payload}
                                    onChange={(e) => setPayload(e.target.value)}
                                    placeholder="1101"
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 outline-none transition-all text-sm"
                                />
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200">
                            <button
                                onClick={onClose}
                                className="px-5 py-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors font-medium"
                            >
                                {locale === 'zh' ? '取消' : 'Cancel'}
                            </button>
                            <button
                                onClick={handleApply}
                                className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 text-white font-medium hover:shadow-lg transition-all"
                            >
                                {locale === 'zh' ? '应用' : 'Apply'}
                            </button>
                        </div>
                    </motion.div>
                </div>
                </>
            )}
        </AnimatePresence>
    );
};

export default SettingsModal;
