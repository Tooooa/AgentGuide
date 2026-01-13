import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Step } from '../../data/mockData';
import { CheckCircle2, Lock, Database, FileDigit } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import RLNCDetailModal from './RLNCDetailModal';
// REMOVED SuccessModal import



interface DecoderPanelProps {
    visibleSteps: Step[];
    erasedIndices: Set<number>;
    targetPayload?: string;
    erasureRate: number;
    setErasureRate: (val: number) => void;
    channelNoiseRef?: React.RefObject<HTMLDivElement | null>;
    decoderProgressRef?: React.RefObject<HTMLDivElement | null>;
    promptInputRef?: React.RefObject<HTMLInputElement | null>;
}

const DecoderPanel: React.FC<DecoderPanelProps> = ({ 
    visibleSteps,
    erasedIndices,
    targetPayload,
    erasureRate,
    setErasureRate,
    channelNoiseRef,
    decoderProgressRef,
    promptInputRef
}) => {
    const { locale } = useI18n();
    const bottomRef = useRef<HTMLDivElement>(null);

    // State for incomplete decoding warning
    const [showIncompleteWarning, setShowIncompleteWarning] = React.useState(false);
    const [hasSeenIncompleteWarning, setHasSeenIncompleteWarning] = React.useState(false);

    // Auto-scroll
    useEffect(() => {
        if (visibleSteps.length > 0) {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [visibleSteps]);

    const requiredRank = targetPayload ? targetPayload.length : 16;

    const validSteps = visibleSteps.filter(s => !erasedIndices.has(s.stepIndex));
    // Calculate current rank based on actual matrix rows received
    // Assuming each non-erased step contributes 1 to rank (linear independence assumed for visualization simplicity)
    const currentRank = Math.min(
        validSteps.reduce((acc, step) => acc + (step.watermark.matrixRows?.length || 0), 0),
        requiredRank
    );
    const progress = (currentRank / requiredRank) * 100;
    const isSuccess = currentRank >= requiredRank;

    // Check if there's a finish step
    const hasFinishStep = visibleSteps.some(step => step.stepType === 'finish');

    // Show warning if task finished but decoding incomplete (only once)
    useEffect(() => {
        console.log('Decoding check:', { hasFinishStep, isSuccess, hasSeenIncompleteWarning, currentRank, requiredRank });
        if (hasFinishStep && !isSuccess && !hasSeenIncompleteWarning) {
            console.log('Showing incomplete warning!');
            setShowIncompleteWarning(true);
        }
    }, [hasFinishStep, isSuccess, hasSeenIncompleteWarning, currentRank, requiredRank]);


    // State for the success modal

    // REMOVED: const [hasShownSuccess, setHasShownSuccess] = React.useState(false);

    // State for RLNC details modal
    const [selectedStep, setSelectedStep] = React.useState<Step | null>(null);




    return (
        <div className="flex flex-col gap-4 h-full bg-slate-50/50">

            <RLNCDetailModal
                isOpen={!!selectedStep}
                onClose={() => setSelectedStep(null)}
                step={selectedStep}
                isErased={selectedStep ? erasedIndices.has(selectedStep.stepIndex) : false}
            />

            {/* Incomplete Decoding Warning */}
            <AnimatePresence>
                {showIncompleteWarning && (
                    <>
                        {/* 遮罩层 */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[200] bg-black/30"
                        />

                        {/* 箭头指引：从解码进度（右上方）指向提示框 */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed z-[201]"
                            style={{
                                top: '280px',
                                right: '400px',
                                width: '600px',
                                height: '500px',
                                pointerEvents: 'none'
                            }}
                        >
                            <svg width="600" height="500" className="absolute inset-0" style={{ overflow: 'visible' }}>
                                {/* 直线路径 */}
                                <path
                                    d="M 560 20 L 70 290"
                                    stroke="#6366f1"
                                    strokeWidth="3"
                                    fill="none"
                                    markerEnd="url(#arrowhead)"
                                />
                                {/* 箭头定义 */}
                                <defs>
                                    <marker
                                        id="arrowhead"
                                        markerWidth="10"
                                        markerHeight="10"
                                        refX="9"
                                        refY="3"
                                        orient="auto"
                                    >
                                        <polygon points="0 0, 10 3, 0 6" fill="#6366f1" />
                                    </marker>
                                </defs>
                            </svg>
                        </motion.div>

                        {/* 提示框 */}
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="fixed z-[201] bg-white rounded-2xl shadow-2xl p-5 w-[320px]"
                            style={{
                                bottom: '160px',
                                left: '390px'
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* 箭头在下方指向输入框 */}
                            <div
                                className="absolute w-0 h-0"
                                style={{
                                    bottom: '-10px',
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    borderLeft: '10px solid transparent',
                                    borderRight: '10px solid transparent',
                                    borderTop: '10px solid white',
                                }}
                            />

                            {/* 标题 */}
                            <div className="flex items-center gap-2 mb-3">
                                <span className="text-base font-bold text-slate-800">
                                    {locale === 'zh' ? '解码提示' : 'Decoding Notice'}
                                </span>
                            </div>

                            {/* 内容 */}
                            <p className="text-sm text-slate-700 leading-relaxed mb-4">
                                {locale === 'zh' 
                                    ? `当前解码进度为${currentRank}/${requiredRank}，继续输入prompt可继续收集数据集，解码进度满才能解码出水印载荷。`
                                    : `Current decoding progress is ${currentRank}/${requiredRank}. Continue inputting prompts to collect more datasets. Decoding progress must be full to decode the watermark payload.`}
                            </p>

                            {/* 按钮 */}
                            <div className="flex justify-end">
                                <button
                                    onClick={() => {
                                        setShowIncompleteWarning(false);
                                        setHasSeenIncompleteWarning(true);
                                    }}
                                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                                >
                                    {locale === 'zh' ? '明白了' : 'Got it'}
                                </button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* 0. Channel Noise Control */}
            <div 
                ref={channelNoiseRef}
                className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mb-1"
            >
                <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${erasureRate > 0 ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`} />
                        <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                            {locale === 'zh' ? '信道噪声 (丢包率)' : 'Channel Noise'}
                        </span>
                    </div>
                    <span className="font-mono text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                        {erasureRate}%
                    </span>
                </div>

                <div className="relative h-2 bg-slate-100 rounded-full mx-1">
                    <div
                        className="absolute h-full bg-rose-400 rounded-full transition-all duration-300"
                        style={{ width: `${(erasureRate / 50) * 100}%` }}
                    />
                    <input
                        type="range"
                        min="0" max="50" step="5"
                        value={erasureRate}
                        onChange={(e) => setErasureRate(Number(e.target.value))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div
                        className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-rose-400 rounded-full pointer-events-none shadow-sm transition-all"
                        style={{ left: `${(erasureRate / 50) * 100}%` }}
                    />
                </div>
                <div className="flex justify-between mt-1 text-[8px] text-slate-300 font-mono px-0.5">
                    <span>0% (Clean)</span>
                    <span>50% (Heavy)</span>
                </div>
            </div>

            {/* 1. Decoding Status / Progress */}
            <div 
                ref={decoderProgressRef}
                className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col gap-3"
            >
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="font-bold text-slate-800 text-sm">{locale === 'zh' ? '解码进度' : 'Decoding Progress'}</h2>
                        <span className="text-xs text-slate-400 font-mono">RANK: {currentRank}/{requiredRank}</span>
                    </div>
                    {isSuccess ? (
                        <div className="bg-emerald-100 text-emerald-600 px-2 py-1 rounded-lg flex items-center gap-1 text-xs font-bold">
                            <CheckCircle2 size={14} /> <span>SUCCESS</span>
                        </div>
                    ) : (
                        <div className="bg-indigo-50 text-indigo-500 px-2 py-1 rounded-lg flex items-center gap-1 text-xs font-bold">
                            <Lock size={14} /> <span>LOCKED</span>
                        </div>
                    )}
                </div>

                {/* Progress Bar */}
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <motion.div
                        className={`h-full ${isSuccess ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.5 }}
                    />
                </div>

                {isSuccess && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="bg-emerald-50 rounded border border-emerald-100 p-2 text-center"
                    >
                        <p className="text-[10px] text-emerald-600 uppercase tracking-wider mb-1">Payload Recovered</p>
                        <p className="font-mono text-lg font-bold text-emerald-800 tracking-widest">{targetPayload || "AGENTMARK"}</p>
                    </motion.div>
                )}
            </div>

            {/* 2. Received Datasets List */}
            <div className="flex-1 overflow-hidden flex flex-col bg-white rounded-2xl shadow-sm border border-slate-100">
                <div className="p-4 border-b border-slate-50 bg-slate-50/30 flex items-center gap-2">
                    <Database size={14} className="text-slate-400" />
                    <h3 className="font-bold text-xs text-slate-500 uppercase tracking-wider">
                        {locale === 'zh' ? '接收到的数据集' : 'Received Datasets'}
                    </h3>
                    <span className="ml-auto bg-slate-200 text-slate-600 text-[10px] px-1.5 py-0.5 rounded-full font-mono">
                        {visibleSteps.length}
                    </span>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-hide">
                    <AnimatePresence>
                        {visibleSteps.map((step) => {
                            const isErased = erasedIndices.has(step.stepIndex);
                            return (
                                <motion.div
                                    key={step.stepIndex}
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    onClick={() => setSelectedStep(step)}
                                    className={`relative p-3 rounded-xl border transition-all group cursor-pointer ${isErased
                                        ? 'bg-rose-50 border-rose-100 opacity-70 grayscale-[0.5] hover:opacity-100'
                                        : 'bg-white border-slate-100 hover:border-indigo-200 hover:shadow-md hover:scale-[1.02] active:scale-[0.98]'}`}
                                >
                                    <div className="flex items-start gap-3">
                                        {/* Icon Box */}
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isErased ? 'bg-rose-100 text-rose-400' : 'bg-indigo-50 text-indigo-500'}`}>
                                            <FileDigit size={16} />
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className={`text-xs font-bold ${isErased ? 'text-rose-400' : 'text-slate-700'}`}>
                                                    Dataset #{step.stepIndex}
                                                </span>
                                                <span className="text-[10px] font-mono text-slate-400">
                                                    {"14:02:23"}
                                                </span>
                                            </div>

                                            {isErased ? (
                                                <div className="text-[10px] text-rose-400 font-medium bg-rose-100/50 px-2 py-1 rounded inline-block">
                                                    PACKET LOST
                                                </div>
                                            ) : (
                                                <div className="space-y-1.5">
                                                    {/* Matrix Bits Visual */}
                                                    {step.watermark.matrixRows.map((row, rIdx) => (
                                                        <div key={rIdx} className="flex items-center gap-1">
                                                            <span className="text-[8px] text-slate-300 w-3">R{rIdx}</span>
                                                            <div className="flex gap-1">
                                                                {row.map((bit, cIdx) => (
                                                                    <div
                                                                        key={cIdx}
                                                                        className={`w-1.5 h-1.5 rounded-full ${bit ? 'bg-indigo-500' : 'bg-slate-200'}`}
                                                                    />
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                    <div ref={bottomRef} className="h-1" />
                </div>
            </div>
        </div>
    );
};

export default DecoderPanel;
