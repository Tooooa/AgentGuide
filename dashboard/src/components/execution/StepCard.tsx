import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart, Bar, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import type { Step } from '../../data/mockData';
import { Brain, Terminal, EyeOff, RotateCcw, ArrowRight, Activity, Bot, User } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import ReactMarkdown from 'react-markdown';
import StepDetailModal from './StepDetailModal';

interface StepCardProps {
    step: Step;
    isErased: boolean;
    showWatermarkDetails?: boolean;
    showDistribution?: boolean;
    displayIndex?: number; // 用于显示的步骤序号，如果不提供则使用 step.stepIndex
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-slate-800 text-white text-xs p-2 rounded shadow-lg border border-slate-700">
                <p className="font-bold mb-1">{payload[0].payload.name}</p>
                <p>Prob: {(payload[0].value * 100).toFixed(1)}%</p>
            </div>
        );
    }
    return null;
};

const StepCard: React.FC<StepCardProps> = ({ step, isErased, showWatermarkDetails = true, showDistribution = false, displayIndex }) => {
    const { t } = useI18n();
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    
    // 使用 displayIndex 如果提供了，否则使用 step.stepIndex
    const stepNumber = displayIndex !== undefined ? displayIndex : step.stepIndex;

    const { sortedDistribution, bins } = React.useMemo(() => {
        const sorted = [...step.distribution].sort((a, b) => b.prob - a.prob);

        const b = sorted.map((d, i) => {
            const nextProb = sorted[i + 1]?.prob || 0;
            return {
                name: `T_${i + 1}`,
                weight: (i + 1) * (d.prob - nextProb),
                isTarget: d.isSelected
            };
        }).filter(item => item.weight > 0.001);

        return { sortedDistribution: sorted, bins: b };
    }, [step.distribution]);

    if (isErased) {
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex gap-4 p-2 opacity-50"
            >
                <div className="flex-shrink-0 mt-1">
                    <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-500">
                        <EyeOff size={18} />
                    </div>
                </div>
                <div className="flex-1 rounded-xl border border-rose-200 bg-rose-50/50 p-4 min-h-[80px] flex items-center gap-4 relative overflow-hidden">
                    {/* Glitch Effect Elements */}
                    <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mixed-blend-overlay"></div>
                    <span className="font-mono font-bold text-rose-500 tracking-[0.2em] text-xs">{t('logDestroyed')}</span>
                    <span className="font-mono text-[10px] text-rose-400">ID: #{stepNumber} :: ERASURE</span>
                </div>
            </motion.div>
        );
    }

    // User Input Bubble (Right Aligned)
    if (step.stepType === 'user_input') {
        return (
            <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex justify-end mb-6"
            >
                <div className="flex gap-4 flex-row-reverse max-w-[80%]">
                    <div className="flex-shrink-0 mt-1">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
                            <User size={18} />
                        </div>
                    </div>
                    <div className="flex-1 text-right">
                        <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-2xl rounded-tr-none p-4 text-white text-sm shadow-md inline-block text-left">
                            <p className="font-bold text-[10px] text-indigo-100 mb-1 uppercase tracking-wide">User Continuation</p>
                            {step.thought}
                        </div>
                    </div>
                </div>
            </motion.div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-4 group"
        >
            {/* Avatar Column */}
            <div className="flex-shrink-0 flex flex-col items-center gap-2 pt-2">
                <div className="w-10 h-10 rounded-full bg-indigo-600 shadow-md shadow-indigo-200 flex items-center justify-center text-white z-10 relative">
                    <Bot size={20} />

                    {/* Step Badge */}
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white border border-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-500 shadow-sm">
                        {stepNumber}
                    </div>
                </div>
            </div>

            {/* Content Column */}
            <div className="flex-1 min-w-0 space-y-4">

                {/* Header Row (Optional - maybe redundant with bubble headers) */}
                {/* <div className="flex items-center gap-2 text-xs text-slate-400 pl-1">
                    <span className="font-mono font-bold">AgentMark Model</span>
                    <span>•</span>
                    <span>{step.stepType.toUpperCase()}</span>
                </div> */}

                {/* 1. THOUGHT + CHARTS Block */}
                <div className="bg-white rounded-2xl rounded-tl-none border border-slate-100 shadow-sm p-5 relative overflow-hidden">
                    {/* Step Badge inside header */}
                    <div className="flex justify-between items-center mb-4 border-b border-slate-50 pb-2">
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 font-mono text-xs font-bold">
                                {stepNumber}
                            </div>
                            <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">{t('step')} #{stepNumber}</span>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${step.stepType === 'finish' ? 'bg-emerald-100 text-emerald-600' : 'bg-indigo-50 text-indigo-500'}`}>
                            {step.stepType}
                        </span>
                    </div>

                    <div className="flex flex-col gap-6">
                        {/* LEFT: THOUGHT */}
                        {((step.thought && step.thought !== "Task Completed") || step.stepType !== 'finish') && (
                            <div className="space-y-2">
                                <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
                                    <Brain size={14} /> THOUGHT
                                </div>
                                <p className="text-sm text-slate-700 italic leading-relaxed font-serif pl-2 border-l-2 border-slate-100">
                                    {step.thought || "Thinking..."}
                                </p>
                            </div>
                        )}

                        {/* RIGHT: WATERMARK CHARTS */}
                        {(showWatermarkDetails || showDistribution) && (
                            <div className="space-y-2 relative">
                                <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                    <span>{showWatermarkDetails ? 'Differential Decoding' : 'Probability Distribution'}</span>
                                    {showWatermarkDetails && <span>Bins</span>}
                                </div>
                                <div 
                                    className={`h-28 flex gap-3 items-center bg-slate-50/50 rounded-xl p-2 border border-slate-100 ${!showWatermarkDetails ? 'justify-center' : 'cursor-pointer hover:bg-white/50 transition-colors'}`}
                                    onClick={showWatermarkDetails ? () => setIsDetailOpen(true) : undefined}
                                >
                                    {/* Chart 1 */}
                                    <div 
                                        className={`h-full relative ${showWatermarkDetails ? 'flex-1' : 'w-1/2 cursor-pointer hover:bg-white/50 transition-colors rounded-lg'}`}
                                        onClick={!showWatermarkDetails ? () => setIsDetailOpen(true) : undefined}
                                    >
                                        <ResponsiveContainer width="99%" height="100%">
                                            <BarChart data={sortedDistribution}>
                                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
                                                {/* Slicing Lines */}
                                                {sortedDistribution.map((d, i) => (
                                                    <ReferenceLine key={`line-${i}`} y={d.prob} stroke="#cbd5e1" strokeDasharray="3 3" />
                                                ))}
                                                <Bar dataKey="prob" radius={[2, 2, 0, 0]} maxBarSize={60}>
                                                    {sortedDistribution.map((entry, index) => (
                                                        <Cell key={`c-${index}`} fill={entry.isSelected ? '#818cf8' : '#ddd6fe'} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                        {/* 为 baseline 模式也添加放大按钮 */}
                                        {!showWatermarkDetails && (
                                            <button onClick={(e) => { e.stopPropagation(); setIsDetailOpen(true); }} className="absolute top-0 right-0 p-1 hover:bg-white rounded shadow-sm transition-colors text-indigo-500 z-10">
                                                <RotateCcw size={10} />
                                            </button>
                                        )}
                                    </div>

                                    {showWatermarkDetails && (
                                        <>
                                            <ArrowRight size={12} className="text-slate-300" />

                                            {/* Chart 2: Bins */}
                                            <div className="flex-1 h-full relative">
                                                <ResponsiveContainer width="99%" height="100%">
                                                    <BarChart data={bins}>
                                                        <Tooltip cursor={{ fill: 'transparent' }} content={() => null} />
                                                        <Bar dataKey="weight" radius={[2, 2, 0, 0]} maxBarSize={60}>
                                                            {bins.map((e, idx) => (
                                                                <Cell key={`b-${idx}`} fill={e.isTarget ? '#6366f1' : '#ddd6fe'} />
                                                            ))}
                                                        </Bar>
                                                    </BarChart>
                                                </ResponsiveContainer>
                                                <button onClick={(e) => { e.stopPropagation(); setIsDetailOpen(true); }} className="absolute top-0 right-0 p-1 hover:bg-white rounded shadow-sm transition-colors text-indigo-500 z-10">
                                                    <RotateCcw size={10} />
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>

                                {/* Pipeline Footer */}
                                {showWatermarkDetails && step.watermark && (
                                    <div className="bg-indigo-50/50 rounded-lg p-1.5 flex items-center justify-between text-[10px] text-slate-500 font-mono border border-indigo-50">
                                        <div className="flex items-center gap-1.5">
                                            <div className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold">
                                                PAYLOAD {step.watermark.bits}
                                            </div>
                                            <span>Sort & Slice</span>
                                            <ArrowRight size={8} />
                                            <span>Select Bin <span className="text-indigo-600 font-bold">T_{step.distribution.findIndex(x => x.isSelected) + 1}</span></span>
                                            <ArrowRight size={8} />
                                            <RotateCcw size={8} />
                                            <span>Sample</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* 2. ACTION Block */}
                <div className="space-y-1 pl-4 border-l-2 border-slate-200 ml-5">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                        <Terminal size={14} /> ACTION
                    </div>
                    <div className="bg-slate-100 rounded-xl p-4 font-mono text-sm text-slate-800 shadow-sm border border-slate-200 break-all overflow-wrap-anywhere">
                        {step.action}
                    </div>
                </div>

                {/* 3. OBSERVATION Block (if tool output) */}
                {step.stepType === 'tool' && (
                    <div className="space-y-1 pl-4 border-l-2 border-slate-200 ml-5">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                            <Activity size={14} /> ENVIRONMENT
                        </div>
                        <div className="bg-slate-50 rounded-xl p-4 font-mono text-xs text-slate-600 shadow-sm border border-slate-200 max-h-40 overflow-y-auto custom-scrollbar">
                            {/* Truncate or formatted observation */}
                            {step.toolDetails || "No observation data."}
                            {/* Note: In mockData, 'toolDetails' might not be populated or is observation? Check mockData logic. */}
                            {/* Checking parseToolBenchData... observation is in tool trace but parsed into 'steps' differently? */}
                            {/* Step type def has toolDetails? */}
                        </div>
                    </div>
                )}

                {/* 4. FINISH RESPONSE Block */}
                {step.stepType === 'finish' && (
                    <div className="space-y-1 pl-4 border-l-2 border-emerald-200 ml-5">
                        <div className="flex items-center gap-2 text-xs font-bold text-emerald-500 uppercase tracking-wider mb-2">
                            <Bot size={14} /> FINAL RESPONSE
                        </div>
                        <div className="bg-emerald-50/50 rounded-xl p-5 font-serif text-sm text-slate-800 shadow-sm border border-emerald-100 leading-relaxed">
                            {/* Use ReactMarkdown to render the final answer */}
                            {step.finalAnswer && step.finalAnswer !== "Task Completed" ? (
                                <div className="prose prose-sm prose-emerald max-w-none text-slate-800">
                                    <ReactMarkdown
                                        components={{
                                            // Custom components to ensure styling matches the dashboard
                                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                            strong: ({ node, ...props }: any) => <span className="font-bold text-slate-900" {...props} />,
                                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                            ul: ({ node, ...props }: any) => <ul className="list-disc pl-4 space-y-1 my-2" {...props} />,
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        ol: ({ node, ...props }: any) => <ol className="list-decimal pl-4 space-y-1 my-2" {...props} />,
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        h1: ({ node, ...props }: any) => <h3 className="text-lg font-bold text-emerald-800 mt-4 mb-2" {...props} />,
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        h2: ({ node, ...props }: any) => <h4 className="text-base font-bold text-emerald-700 mt-3 mb-2" {...props} />,
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        h3: ({ node, ...props }: any) => <h5 className="text-sm font-bold text-emerald-600 mt-2 mb-1" {...props} />,
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        a: ({ node, ...props }: any) => <a className="text-emerald-600 underline hover:text-emerald-800" {...props} />,
                                    }}
                                >
                                    {(step.finalAnswer || step.toolDetails || "").replace(/^\[Finish\]\s*/, "")}
                                </ReactMarkdown>
                            </div>
                            ) : (
                                <div className="text-slate-500 italic">
                                    {step.thought || "Task completed"}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <StepDetailModal
                    isOpen={isDetailOpen}
                    onClose={() => setIsDetailOpen(false)}
                    step={step}
                    mode={showWatermarkDetails ? 'watermarked' : 'baseline'}
                    displayIndex={stepNumber}
                />
            </div>
        </motion.div>
    );
};

export default StepCard;
