import React, { useEffect, useRef, useState } from 'react';
import StepCard from './StepCard';
import type { Step } from '../../types';
import { useI18n } from '../../i18n/I18nContext';
import { User, Bot, Play, Pause, Sparkles, X } from 'lucide-react';
import { scenarios } from '../../data/mockData';

interface FlowFeedProps {
    visibleSteps: Step[];
    erasedIndices: Set<number>;
    userQuery: string;
    userQueryLabel?: string;
    userQueryFormat?: 'plain' | 'json';
    userInputHighlight?: string;
    userInputLabel?: string;
    onContinue?: (prompt: string) => void;
    isPlaying?: boolean;
    onTogglePlay?: () => void;
    scenarioId?: string;
    promptInputRef?: React.RefObject<HTMLInputElement | null>;
    variant?: 'default' | 'add_agent';
}

const FlowFeed: React.FC<FlowFeedProps> = ({
    visibleSteps,
    erasedIndices,
    userQuery,
    userQueryLabel,
    userQueryFormat = 'plain',
    userInputHighlight,
    userInputLabel,
    onContinue,
    isPlaying,
    onTogglePlay,
    scenarioId,
    promptInputRef,
    variant = 'default'
}) => {
    const isAddAgent = variant === 'add_agent';
    const bottomRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const isAtBottomRef = useRef(true);
    const { t, locale } = useI18n();
    const [continueInput, setContinueInput] = useState(''); // Add input state management

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

    const scrollContainerClass = isAddAgent
        ? 'flex-1 overflow-y-auto px-5 py-4 space-y-6 scrollbar-hide'
        : 'flex-1 overflow-y-auto px-4 py-6 space-y-8 scrollbar-hide';


    return (
        <div className="flex flex-col h-full relative">
            <div
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className={scrollContainerClass}
            >
                {/* User Query Bubble */}
                {userQuery && (
                    <div className="flex justify-end pr-2">
                        <div className="flex gap-4 flex-row-reverse max-w-[80%]">
                            <div className="flex-shrink-0 mt-1">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isAddAgent ? 'bg-indigo-100 text-indigo-600' : 'bg-indigo-100 text-indigo-600'}`}>
                                    <User size={18} />
                                </div>
                            </div>
                            <div className="flex-1 text-right">
                                <div className={`rounded-2xl rounded-tr-none p-5 text-sm shadow-sm inline-block text-left relative overflow-hidden ${isAddAgent ? 'bg-indigo-50 border border-indigo-100 text-indigo-900' : 'bg-indigo-50 border border-indigo-100 text-indigo-900'}`}>
                                    {/* Decorative background element */}
                                    <div className={`absolute top-0 right-0 w-16 h-16 bg-gradient-to-br to-transparent rounded-bl-full pointer-events-none ${isAddAgent ? 'from-indigo-100/50' : 'from-indigo-100/50'}`} />

                                    <p className={`font-bold text-[10px] mb-2 uppercase tracking-wider flex items-center gap-1.5 ${isAddAgent ? 'text-indigo-400' : 'text-indigo-400'}`}>
                                        <div className={`w-1 h-1 rounded-full ${isAddAgent ? 'bg-indigo-400' : 'bg-indigo-400'}`} />
                                        {userQueryLabel || "User Prompt"}
                                    </p>
                                    <p className={`leading-relaxed relative z-10 font-medium ${userQueryFormat === 'json' ? 'whitespace-pre-wrap' : ''}`}>
                                        {userQueryFormat === 'json'
                                            ? (userQuery || "No query provided.").replace(/\\n/g, '\n')
                                            : (userQuery || "No query provided.")}
                                    </p>
                                </div>
                                {userInputHighlight && (
                                    <div className={`mt-3 bg-white/95 rounded-xl p-3 text-left text-slate-700 shadow-sm ${isAddAgent ? 'border border-indigo-100' : 'border border-indigo-100'}`}>
                                        <p className={`font-bold text-[10px] mb-1 uppercase tracking-wide ${isAddAgent ? 'text-indigo-500' : 'text-indigo-500'}`}>
                                            {userInputLabel || "User Input"}
                                        </p>
                                        <div className="text-xs font-mono whitespace-pre-wrap break-words">
                                            {userInputHighlight}
                                        </div>
                                    </div>
                                )}
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
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center ${isAddAgent ? 'bg-gradient-to-br from-indigo-50 to-blue-50' : 'bg-gradient-to-br from-indigo-50 to-blue-50'}`}>
                            <Bot size={32} className={isAddAgent ? 'text-indigo-300' : 'text-indigo-300'} />
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
                    // Calculate display index: skip user_input steps
                    // Only count non-user_input steps
                    const nonUserSteps = visibleSteps.slice(0, index + 1).filter(s => s.stepType !== 'user_input' && !s.isHidden);
                    const displayIndex = nonUserSteps.length;

                    return step.isHidden ? null : (
                        <StepCard
                            key={`step-${index}-${step.stepIndex}`}
                            step={step}
                            isErased={erasedIndices.has(step.stepIndex)}
                            showWatermarkDetails={true}
                            displayIndex={step.stepType === 'user_input' ? undefined : displayIndex}
                            variant={variant}
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
                                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide pl-2">{locale === 'zh' ? '建议提示词' : 'Suggested Prompts'}</p>
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
                                                className={`w-full text-left px-4 py-3 flex items-center gap-3 group border-b border-slate-50 last:border-0 transition-colors ${isAddAgent ? 'hover:bg-amber-50' : 'hover:bg-indigo-50'}`}
                                            >
                                                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transaction-colors ${isAddAgent ? 'bg-indigo-100 text-indigo-600 group-hover:bg-indigo-200' : 'bg-indigo-100 text-indigo-600 group-hover:bg-indigo-200'}`}>
                                                    <Sparkles size={14} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-bold text-slate-500 mb-0.5">
                                                        {locale === 'zh' ? s.title.zh : s.title.en}
                                                    </p>
                                                    <p className={`text-sm text-slate-700 font-medium truncate ${isAddAgent ? 'group-hover:text-indigo-700' : 'group-hover:text-indigo-700'}`}>
                                                        {s.userQuery}
                                                    </p>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}

                        <div className={`bg-white rounded-2xl p-4 shadow-xl ring-1 backdrop-blur-sm ${isAddAgent ? 'border border-indigo-100 ring-indigo-50/50' : 'border border-indigo-100 ring-indigo-50/50'}`}>
                            <p className={`text-xs font-bold uppercase tracking-wide mb-2 flex items-center gap-2 ${isAddAgent ? 'text-indigo-500' : 'text-indigo-500'}`}>
                                <Bot size={14} /> {locale === 'zh' ? '继续任务' : 'Continue Task'}
                            </p>
                            <div className="relative z-10 flex gap-3 items-center">
                                {onContinue && (
                                    <>
                                        <input
                                            ref={promptInputRef}
                                            id="continue-input"
                                            type="text"
                                            value={continueInput}
                                            onChange={(e) => setContinueInput(e.target.value)}
                                            placeholder={locale === 'zh' ? "输入新指令继续..." : "Input new prompt to continue..."}
                                            className={`flex-1 bg-white/80 rounded-2xl px-5 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-all shadow-inner
                                                ${isAddAgent ? 'border border-indigo-100/80 focus:border-indigo-400 focus:ring-indigo-200/70' : 'border border-indigo-100/80 focus:border-indigo-400 focus:ring-indigo-200/70'}
                                                ${(isSending || isPlaying) ? 'opacity-70 bg-slate-100 cursor-not-allowed' : ''}`}
                                            disabled={isSending || isPlaying}
                                            onFocus={() => setShowPrompts(true)}
                                            // Removed onBlur to allow clicking on the popup
                                            onKeyDown={async (e) => {
                                                if (e.key === 'Enter' && !isSending && !isPlaying) {
                                                    const val = continueInput.trim();
                                                    if (val && onContinue) {
                                                        setContinueInput(''); // Clear immediately
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
                                            className={`rounded-2xl px-6 py-2.5 text-sm font-semibold transition-all flex items-center gap-2
                                                ${isSending || isPlaying
                                                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                                                    : isAddAgent
                                                        ? 'bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 text-white shadow-[0_10px_24px_rgba(59,130,246,0.35)] hover:from-sky-400 hover:via-blue-500 hover:to-indigo-500 hover:shadow-[0_16px_30px_rgba(59,130,246,0.45)]'
                                                        : 'bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 text-white shadow-[0_10px_24px_rgba(59,130,246,0.35)] hover:from-sky-400 hover:via-blue-500 hover:to-indigo-500 hover:shadow-[0_16px_30px_rgba(59,130,246,0.45)]'}`}
                                            disabled={isSending || isPlaying}
                                            onClick={async () => {
                                                const val = continueInput.trim();
                                                if (val && onContinue) {
                                                    setContinueInput(''); // Clear immediately
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
                                                    {locale === 'zh' ? '发送中...' : 'Sending...'}
                                                </>
                                            ) : (
                                                locale === 'zh' ? '发送' : 'Send'
                                            )}
                                        </button>
                                    </>
                                )}
                                {!onContinue && hasSteps && (
                                    <div className="flex-1 text-sm text-slate-400 italic px-2">
                                        {locale === 'zh' ? '（当前为模拟模式，仅供查看）' : '(Simulation Mode - View Only)'}
                                    </div>
                                )}
                                {onTogglePlay && (
                                    <button
                                        className="rounded-xl px-3 py-2 text-sm font-bold transition-all flex items-center justify-center gap-2
                                            bg-white text-slate-500 border border-slate-200 hover:bg-slate-50 hover:text-indigo-600 hover:border-indigo-200 shadow-sm hover:shadow-md"
                                        onClick={onTogglePlay}
                                        title={isPlaying ? (locale === 'zh' ? '暂停' : 'Pause') : (locale === 'zh' ? '继续' : 'Resume')}
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
