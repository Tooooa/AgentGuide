import React, { useRef, useEffect, useMemo } from 'react';
import { useI18n } from '../../i18n/I18nContext';

import StepCard from '../execution/StepCard';
import type { Step } from '../../types';

import { User } from 'lucide-react';

interface ComparisonViewProps {
    visibleSteps: Step[];
    erasedIndices: Set<number>;
    scenarioId?: string;
    userQuery?: string;
    promptInstruction?: string;
    evaluationRef?: React.RefObject<HTMLDivElement>;

    chartRef?: React.RefObject<HTMLDivElement>;
    variant?: 'default' | 'add_agent';
}

// 1221: Segment structure for aligning user questions
interface Segment {
    baselineSteps: Step[];
    watermarkedSteps: Step[];
    userInput?: Step; // The user_input step that ends this segment (if any)
}

const ComparisonView: React.FC<ComparisonViewProps> = ({
    visibleSteps,
    erasedIndices,
    scenarioId,
    userQuery,
    promptInstruction,
    evaluationRef,
    chartRef,
    variant = 'default'
}) => {
    const isAddAgent = variant === 'add_agent';
    const { locale } = useI18n();

    const scrollRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const isAtBottomRef = useRef(true);

    // Reset scroll to bottom when scenario changes
    useEffect(() => {
        isAtBottomRef.current = true;
        bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }, [scenarioId]);

    // Smart auto-scroll when steps change
    useEffect(() => {
        if (visibleSteps.length > 0 && isAtBottomRef.current) {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [visibleSteps]);

    const handleScroll = () => {
        if (scrollRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
            isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 50;
        }
    };

    // 1221: Split steps into segments by user_input to align user questions
    const segments = useMemo(() => {
        const result: Segment[] = [];
        let currentSegment: Segment = { baselineSteps: [], watermarkedSteps: [] };

        for (const step of visibleSteps) {
            if (step.stepType === 'user_input') {
                // This user_input ends the current segment
                currentSegment.userInput = step;
                result.push(currentSegment);
                // Start new segment
                currentSegment = { baselineSteps: [], watermarkedSteps: [] };
            } else {
                // Construct baseline step
                const baselineStep: Step = step.baseline ? {
                    ...step,
                    thought: step.thought || step.baseline.thought,
                    action: step.baseline.action,
                    toolDetails: step.baseline.toolDetails,
                    distribution: step.baseline.distribution,
                    stepType: step.baseline.stepType,
                    finalAnswer: step.baseline.finalAnswer,
                    isHidden: step.baseline.isHidden,
                    watermark: { bits: "", matrixRows: [], rankContribution: 0 },
                    metrics: undefined
                } : step;

                // 1221: Check if has content (no hiding, just skip empty)
                const hasBaselineContent = !baselineStep.isHidden && (baselineStep.thought || baselineStep.action || baselineStep.stepType === 'finish');
                const hasWatermarkedContent = !step.isHidden && (step.thought || step.action || step.stepType === 'finish');

                if (hasBaselineContent) {
                    currentSegment.baselineSteps.push(baselineStep);
                }
                if (hasWatermarkedContent) {
                    currentSegment.watermarkedSteps.push(step);
                }
            }
        }

        // Push the last segment if it has any steps
        if (currentSegment.baselineSteps.length > 0 || currentSegment.watermarkedSteps.length > 0) {
            result.push(currentSegment);
        }

        return result;
    }, [visibleSteps]);

    const renderUserQueryPair = (query: string, key: string) => {
        // Show two in plugin mode (User Question + User Question + Instruction), only one centered in standard mode
        if (isAddAgent && promptInstruction) {
            const rightQuery = `${query}\n\n${promptInstruction}`;
            return (
                <div key={key} className="col-span-2 my-4">
                    <div className="w-full bg-gradient-to-r from-indigo-50/50 to-violet-50/50 border border-indigo-100 rounded-2xl p-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div className="flex-1">
                                <div className="bg-white border border-slate-200 rounded-2xl p-5 text-sm shadow-sm flex items-center gap-4">
                                    <div className="flex-shrink-0">
                                        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                                            <User size={16} />
                                        </div>
                                    </div>
                                    <div className="flex-1">
                                        <p className="font-bold text-[10px] text-slate-400 mb-1 uppercase tracking-wide">{locale === 'zh' ? '用户提问' : 'User Question'}</p>
                                        <p className="text-slate-700 leading-relaxed whitespace-pre-wrap">{query}</p>
                                    </div>
                                </div>
                            </div>
                            <div className="flex-1">
                                <div className="bg-white border border-slate-200 rounded-2xl p-5 text-sm shadow-sm flex items-center gap-4">
                                    <div className="flex-shrink-0">
                                        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
                                            <User size={16} />
                                        </div>
                                    </div>
                                    <div className="flex-1">
                                        <p className="font-bold text-[10px] text-slate-400 mb-1 uppercase tracking-wide">{locale === 'zh' ? '用户提问 + 指令' : 'User Question + Instruction'}</p>
                                        <p className="text-slate-700 leading-relaxed whitespace-pre-wrap">{rightQuery}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        // Standard mode: show only one centered user question
        return (
            <div key={key} className="col-span-2 my-4">
                <div className="w-full flex justify-center">
                    <div className="max-w-2xl w-full bg-gradient-to-r from-indigo-50/50 to-violet-50/50 border border-indigo-100 rounded-2xl p-5">
                        <div className="bg-white border border-slate-200 rounded-2xl p-5 text-sm shadow-sm flex items-center gap-4">
                            <div className="flex-shrink-0">
                                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                                    <User size={16} />
                                </div>
                            </div>
                            <div className="flex-1">
                                <p className="font-bold text-[10px] text-slate-400 mb-1 uppercase tracking-wide">{locale === 'zh' ? '用户提问' : 'User Question'}</p>
                                <p className="text-slate-700 leading-relaxed whitespace-pre-wrap">{query}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };


    return (
        <div className="h-full flex flex-col gap-4">
            {/* Main Content - Single scrollable container with aligned segments */}
            <div
                className="flex-1 overflow-y-auto bg-slate-50 rounded-2xl scrollbar-thin scrollbar-thumb-slate-200"
                ref={scrollRef}
                onScroll={handleScroll}
            >
                {/* Column Headers - Fixed at top */}
                <div ref={evaluationRef} className="sticky top-0 bg-slate-50 z-20 px-4 pt-4 pb-2">
                    <div className="grid grid-cols-2 gap-6">
                        <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-sm">
                            <span className="font-bold text-slate-600 text-sm">{locale === 'zh' ? '无水印Agent' : 'Original (Base)'}</span>
                        </div>
                        <div className={`p-3 rounded-xl shadow-sm ${isAddAgent
                            ? 'bg-amber-50 border border-amber-200'
                            : 'bg-indigo-50 border border-indigo-200'
                            }`}>
                            <span className={`font-bold text-sm ${isAddAgent ? 'text-amber-700' : 'text-indigo-700'
                                }`}>{locale === 'zh' ? '有水印Agent' : 'Ours (Watermarked)'}</span>
                        </div>
                    </div>
                </div>

                {/* Content area with padding */}
                <div className="px-4 pb-4">
                    {/* Initial User Query - Aligned in center */}
                    {userQuery && renderUserQueryPair(userQuery, 'initial-query')}

                    {/* Render segments */}
                    {segments.map((segment, segIndex) => {
                        // Calculate accumulated step count before current segment
                        const prevBaselineCount = segments.slice(0, segIndex).reduce((acc, s) => acc + s.baselineSteps.length, 0);
                        const prevWatermarkedCount = segments.slice(0, segIndex).reduce((acc, s) => acc + s.watermarkedSteps.length, 0);

                        return (
                            <React.Fragment key={`segment-${segIndex}`}>
                                {/* Two columns for agent steps */}
                                <div className="grid grid-cols-2 gap-6 mb-4">
                                    {/* Left: Baseline steps */}
                                    <div className="space-y-4 p-2 bg-white rounded-xl border border-slate-100">
                                        {segment.baselineSteps.length > 0 ? (
                                            segment.baselineSteps.map((step, stepIdx) => (
                                                <StepCard
                                                    key={`nw-${segIndex}-${stepIdx}`}
                                                    step={step}
                                                    isErased={false}
                                                    showWatermarkDetails={false}
                                                    showDistribution={true}
                                                    displayIndex={prevBaselineCount + stepIdx + 1}
                                                    variant={variant}
                                                />
                                            ))
                                        ) : (
                                            <div className="text-center text-slate-400 text-sm py-8 italic">
                                                {locale === 'zh' ? '(暂无更多步骤)' : '(No more steps)'}
                                            </div>
                                        )}
                                    </div>

                                    {/* Right: Watermarked steps */}
                                    <div ref={segIndex === 0 ? chartRef : undefined} className={`space-y-4 p-2 bg-white rounded-xl border ${isAddAgent ? 'border-amber-100' : 'border-indigo-100'
                                        }`}>
                                        {segment.watermarkedSteps.length > 0 ? (
                                            segment.watermarkedSteps.map((step, stepIdx) => (
                                                <StepCard
                                                    key={`wm-${segIndex}-${stepIdx}`}
                                                    step={step}
                                                    isErased={erasedIndices.has(step.stepIndex)}
                                                    showWatermarkDetails={true}
                                                    displayIndex={prevWatermarkedCount + stepIdx + 1}
                                                    variant={variant}
                                                />
                                            ))
                                        ) : (
                                            <div className="text-center text-slate-400 text-sm py-8 italic">
                                                {locale === 'zh' ? '(暂无更多步骤)' : '(No more steps)'}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* User Input - Centered and aligned */}
                                {segment.userInput && renderUserQueryPair(segment.userInput.thought || '', `user-input-${segIndex}`)}
                            </React.Fragment>
                        )
                    })}

                    <div ref={bottomRef} className="h-4" />
                </div>
            </div>
        </div>
    );
};

export default ComparisonView;
