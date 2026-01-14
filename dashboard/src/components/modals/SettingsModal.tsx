import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Zap } from 'lucide-react';
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
    hasActiveConversation?: boolean;
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
    onInitSession,
    hasActiveConversation = false
}) => {
    const { locale } = useI18n();
    const [showPayloadWarning, setShowPayloadWarning] = useState(false);
    const [showPayloadFormatError, setShowPayloadFormatError] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setShowPayloadFormatError(false);
        }
    }, [isOpen]);

    const handlePayloadChange = (newPayload: string) => {
        // 验证载荷内容只包含0和1
        const isValidPayload = /^[01]*$/.test(newPayload);

        if (!isValidPayload && newPayload !== '') {
            setShowPayloadFormatError(true);
            return; // 不更新payload
        } else {
            setShowPayloadFormatError(false);
        }

        if (hasActiveConversation && !showPayloadWarning) {
            setShowPayloadWarning(true);
        }
        setPayload(newPayload);
    };

    const handleApply = () => {
        // 只有在实时模式且有自定义查询内容时才初始化会话
        if (onInitSession && isLiveMode && customQuery.trim()) {
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
                        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100]"
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
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            transition={{ type: "spring", duration: 0.4, bounce: 0.3 }}
                            className="w-[640px] max-w-[95vw] bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-100"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Header */}
                            <div className="flex items-start justify-between px-8 pt-8 pb-4 bg-white">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-indigo-50 rounded-2xl text-indigo-600">
                                        <Zap size={24} strokeWidth={2.5} />
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                                            {locale === 'zh' ? '设置' : 'Settings'}
                                        </h2>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${isLiveMode ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
                                                }`}>
                                                {isLiveMode
                                                    ? (locale === 'zh' ? '实时模式' : 'Live Mode')
                                                    : (locale === 'zh' ? '模拟' : 'Simulation')}
                                            </span>
                                            <span className="text-xs text-slate-400 font-mono">
                                                {new Date().toLocaleTimeString()}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="p-2 -mr-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            {/* Content */}
                            <div className="px-8 py-2 space-y-6">

                                {/* Info Box - Similar to "RLNC 编码详情" */}
                                <div className="p-5 bg-indigo-50/80 rounded-2xl border border-indigo-100/50">
                                    <h3 className="text-sm font-bold text-indigo-900 mb-2 flex items-center gap-2">
                                        {locale === 'zh' ? '系统配置' : 'System Configuration'}
                                    </h3>
                                    <p className="text-sm text-indigo-700/80 leading-relaxed">
                                        {locale === 'zh'
                                            ? '配置您的 Agent 运行时参数和载荷设置。更改将影响实时处理和水印行为。'
                                            : 'Configure your agent\'s runtime parameters and payload settings. Changes affect real-time processing and watermarking behavior.'}
                                    </p>
                                </div>

                                <div className="space-y-6">
                                    {/* Mode Switcher */}
                                    <div>
                                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-slate-400"></div>
                                            {locale === 'zh' ? '运行模式' : 'Runtime Mode'}
                                        </label>
                                        <div className="flex gap-3 p-1.5 bg-slate-50 rounded-2xl border border-slate-100">
                                            <button
                                                onClick={() => isLiveMode && onToggleLiveMode()}
                                                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-sm font-bold transition-all duration-200 ${!isLiveMode
                                                    ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-200/50'
                                                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100/50'
                                                    }`}
                                            >
                                                {locale === 'zh' ? '模拟' : 'Simulation'}
                                            </button>
                                            <button
                                                onClick={() => !isLiveMode && onToggleLiveMode()}
                                                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-sm font-bold transition-all duration-200 ${isLiveMode
                                                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
                                                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100/50'
                                                    }`}
                                            >
                                                <Zap size={16} fill="currentColor" /> {locale === 'zh' ? '实时模式' : 'Live Mode'}
                                            </button>
                                        </div>
                                    </div>

                                    {/* API Key */}
                                    {isLiveMode && (
                                        <div>
                                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>
                                                {locale === 'zh' ? 'DeepSeek API 密钥' : 'DeepSeek API Key'}
                                            </label>
                                            <div className="relative group">
                                                <input
                                                    type="password"
                                                    value={apiKey}
                                                    onChange={(e) => setApiKey(e.target.value)}
                                                    placeholder="sk-..."
                                                    className="w-full pl-4 pr-4 py-3.5 bg-slate-50 rounded-2xl border-2 border-transparent focus:bg-white focus:border-indigo-100 focus:ring-4 focus:ring-indigo-50 outline-none transition-all text-sm font-mono text-slate-600 placeholder:text-slate-300"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Payload */}
                                    <div>
                                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                                            {locale === 'zh' ? '载荷内容' : 'Active Payload'}
                                        </label>
                                        <div className="relative">
                                            <input
                                                type="text"
                                                value={payload}
                                                onChange={(e) => handlePayloadChange(e.target.value)}
                                                placeholder="1101"
                                                className="w-full px-4 py-3.5 bg-slate-50 rounded-2xl border-2 border-transparent focus:bg-white focus:border-blue-100 focus:ring-4 focus:ring-blue-50 outline-none transition-all text-sm font-bold text-slate-700 tracking-widest placeholder:text-slate-300 placeholder:font-normal placeholder:tracking-normal"
                                            />
                                            {!payload && (
                                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                    <span className="text-slate-300 italic text-sm">
                                                        {locale === 'zh' ? '暂无载荷数据' : 'No payload data available'}
                                                    </span>
                                                </div>
                                            )}
                                        </div>

                                        {showPayloadFormatError && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                className="mt-3 text-red-500 text-xs font-bold px-1"
                                            >
                                                {locale === 'zh' ? '载荷内容只能包含0和1' : 'Payload can only contain 0 and 1'}
                                            </motion.div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="p-8 pt-4">
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={onClose}
                                        className="flex-1 py-3.5 rounded-xl text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-all font-bold text-sm"
                                    >
                                        {locale === 'zh' ? '取消' : 'Cancel'}
                                    </button>
                                    <button
                                        onClick={handleApply}
                                        className="flex-[2] py-3.5 rounded-xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 hover:shadow-lg hover:shadow-slate-200 transition-all active:scale-[0.98]"
                                    >
                                        {locale === 'zh' ? '确认' : 'Confirm'}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
};

export default SettingsModal;
