import React, { useEffect, useRef, useState } from 'react';
import StepCard from './StepCard';
import type { Step } from '../../data/mockData';
import { useI18n } from '../../i18n/I18nContext';
import { User, Bot, Play, Pause, Sparkles, X } from 'lucide-react';
import { scenarios } from '../../data/mockData';

interface FlowFeedProps {
    visibleSteps: Step[];
    erasedIndices: Set<number>;
    userQuery: string;
    onContinue?: (prompt: string) => void;
    isPlaying?: boolean;
    onTogglePlay?: () => void;
    scenarioId?: string;
    promptInputRef?: React.RefObject<HTMLInputElement | null>;
}

const FlowFeed: React.FC<FlowFeedProps> = ({ visibleSteps, erasedIndices, userQuery, onContinue, isPlaying, onTogglePlay, scenarioId, promptInputRef }) => {
    const bottomRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const isAtBottomRef = useRef(true);
    const { t, locale } = useI18n();
    const [continueInput, setContinueInput] = useState(''); // 添加输入框状态管理

    // Track user scroll position
    const handleScroll = () => {
        if (!scrollContainerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
        // User is at bottom if they are within 50px of the bottom
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
        isAtBottomRef.current = isAtBottom;
    };

    // Reset scroll to bottom when scenario changes
    useEffect(() => {
        isAtBottomRef.current = true;
        bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }, [scenarioId]);

    // Smart auto-scroll when steps change
    useEffect(() => {
        if (isAtBottomRef.current) {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [visibleSteps]);

    const [isSending, setIsSending] = React.useState(false);
    const [showPrompts, setShowPrompts] = React.useState(false);

    // Determine if we have content to show
    const hasSteps = visibleSteps.length > 0;

    // Always show control bar if we have steps (to allow pausing), or if finished, OR if we can continue (allows starting new)
    const showControls = hasSteps || !!onContinue;

    return (
        <div className="flex flex-col h-full relative">
            <div
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className={`flex-1 overflow-y-auto px-4 py-6 space-y-8 scrollbar-hide`}
            >
                {/* User Query Bubble */}
                {userQuery && (
                    <div className="flex justify-end pr-2">
                        <div className="flex gap-4 flex-row-reverse max-w-[80%]">
                            <div className="flex-shrink-0 mt-1">
                                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
                                    <User size={18} />
                                </div>
                            </div>
                            <div className="flex-1 text-right">
                                <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-2xl rounded-tr-none p-4 text-white text-sm shadow-md inline-block text-left">
                                    <p className="font-bold text-[10px] text-indigo-100 mb-1 uppercase tracking-wide">User Prompt</p>
                                    {userQuery || "No query provided."}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {visibleSteps.length === 0 && userQuery && (
                    <div className="flex flex-col items-center justify-center text-slate-400 space-y-2 py-10">
                        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center animate-pulse">
                            <Bot size={20} className="text-slate-300" />
                        </div>
                        <p className="text-sm">{t('waiting')}</p>
                    </div>
                )}

                {visibleSteps.length === 0 && !userQuery && (
                    <div className="flex flex-col items-center justify-center text-slate-400 space-y-4 py-20">
                        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-50 to-blue-50 flex items-center justify-center">
                            <Bot size={32} className="text-indigo-300" />
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-medium text-slate-600 mb-1">
                                {locale === 'zh' ? '开始新对话' : 'Start a New Conversation'}
                            </p>
                            <p className="text-sm text-slate-400">
                                {locale === 'zh' ? '在下方输入框中输入您的问题' : 'Enter your question in the input box below'}
                            </p>
                        </div>
                    </div>
                )}

                {visibleSteps.map((step, index) => {
                    // 计算显示索引：跳过 user_input 类型的步骤
                    // 只计算非 user_input 步骤的序号
                    const nonUserSteps = visibleSteps.slice(0, index + 1).filter(s => s.stepType !== 'user_input' && !s.isHidden);
                    const displayIndex = nonUserSteps.length;
                    
                    return step.isHidden ? null : (
                        <StepCard
                            key={`step-${index}-${step.stepIndex}`}
                            step={step}
                            isErased={erasedIndices.has(step.stepIndex)}
                            displayIndex={step.stepType === 'user_input' ? undefined : displayIndex}
                        />
                    );
                })}

                <div ref={bottomRef} className="h-4" />
            </div>

            {/* Sticky Continue Section - Now Flex Item at Bottom */}
            {showControls && (
                <div className="flex-shrink-0 py-6 px-4 w-full z-20">
                    <div className="w-full relative">
                        {/* Preset Prompts Popup */}
                        {showPrompts && (
                            <>
                                <div className="fixed inset-0 z-10" onClick={() => setShowPrompts(false)} />
                                <div className="absolute bottom-full left-0 mb-2 w-full bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden z-20">
                                    <div className="p-2 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide pl-2">Suggested Prompts</p>
                                        <button onClick={() => setShowPrompts(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-200">
                                            <X size={14} />
                                        </button>
                                    </div>
                                    <div className="max-h-48 overflow-y-auto">
                                        {scenarios.map((s, idx) => (
                                            <button
                                                key={idx}
                                                onClick={() => {
                                                    setContinueInput(s.userQuery);
                                                    setShowPrompts(false);
                                                }}
                                                className="w-full text-left px-4 py-3 hover:bg-indigo-50 flex items-center gap-3 group border-b border-slate-50 last:border-0 transition-colors"
                                            >
                                                <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center flex-shrink-0 group-hover:bg-indigo-200 transaction-colors">
                                                    <Sparkles size={14} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-bold text-slate-500 mb-0.5">
                                                        {locale === 'zh' ? s.title.zh : s.title.en}
                                                    </p>
                                                    <p className="text-sm text-slate-700 group-hover:text-indigo-700 font-medium truncate">
                                                        {s.userQuery}
                                                    </p>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}

                        <div className="bg-white rounded-2xl p-4 shadow-xl border border-indigo-100 ring-1 ring-indigo-50/50 backdrop-blur-sm">
                            <p className="text-xs font-bold text-indigo-500 uppercase tracking-wide mb-2 flex items-center gap-2">
                                <Bot size={14} /> Continue Task
                            </p>
                            <div className="flex gap-2">
                                <input
                                    ref={promptInputRef}
                                    id="continue-input"
                                    type="text"
                                    value={continueInput}
                                    onChange={(e) => setContinueInput(e.target.value)}
                                    placeholder={locale === 'zh' ? "输入新指令继续..." : "Input new prompt to continue..."}
                                    className={`flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-indigo-500 transition-colors
                                        ${(isSending || isPlaying) ? 'opacity-70 bg-slate-100 cursor-not-allowed' : ''}`}
                                    disabled={isSending || isPlaying}
                                    onFocus={() => setShowPrompts(true)}
                                    // Removed onBlur to allow clicking on the popup
                                    onKeyDown={async (e) => {
                                        if (e.key === 'Enter' && !isSending && !isPlaying) {
                                            const val = continueInput.trim();
                                            if (val && onContinue) {
                                                setContinueInput(''); // 立即清空
                                                setIsSending(true);
                                                setShowPrompts(false);
                                                try {
                                                    await onContinue(val);
                                                } finally {
                                                    setIsSending(false);
                                                }
                                            }
                                        }
                                    }}
                                />
                                <button
                                    className={`rounded-xl px-6 py-2 text-sm font-bold transition-all flex items-center gap-2
                                        ${isSending || isPlaying
                                            ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                                            : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-md hover:shadow-lg'}`}
                                    disabled={isSending || isPlaying}
                                    onClick={async () => {
                                        const val = continueInput.trim();
                                        if (val && onContinue) {
                                            setContinueInput(''); // 立即清空
                                            setIsSending(true);
                                            setShowPrompts(false);
                                            try {
                                                await onContinue(val);
                                            } finally {
                                                setIsSending(false);
                                            }
                                        }
                                    }}
                                >
                                    {isSending ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            Sending...
                                        </>
                                    ) : (
                                        "Send"
                                    )}
                                </button>
                                {onTogglePlay && (
                                    <button
                                        className="rounded-xl px-3 py-2 text-sm font-bold transition-all flex items-center justify-center gap-2
                                            bg-white text-slate-500 border border-slate-200 hover:bg-slate-50 hover:text-indigo-600 hover:border-indigo-200 shadow-sm hover:shadow-md"
                                        onClick={onTogglePlay}
                                        title={isPlaying ? "Pause" : "Resume"}
                                    >
                                        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FlowFeed;
