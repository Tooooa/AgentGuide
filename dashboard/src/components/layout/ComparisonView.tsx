import React, { useRef, useEffect, useMemo } from 'react';

import StepCard from '../execution/StepCard';
import type { Step } from '../../data/mockData';

import { Columns, Eye, EyeOff, User } from 'lucide-react';

interface ComparisonViewProps {
    visibleSteps: Step[];
    erasedIndices: Set<number>;
    scenarioId?: string;
    evaluationResult?: { model_a_score: number, model_b_score: number, reason: string } | null;
    userQuery?: string;
}

// 1221: Segment structure for aligning user questions
interface Segment {
    baselineSteps: Step[];
    watermarkedSteps: Step[];
    userInput?: Step; // The user_input step that ends this segment (if any)
}

const ComparisonView: React.FC<ComparisonViewProps> = ({ visibleSteps, erasedIndices, scenarioId, evaluationResult, userQuery }) => {

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
                    thought: step.baseline.thought,
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

    // Render user query bubble
    const renderUserQuery = (query: string, key: string) => (
        <div key={key} className="col-span-2 my-4">
            <div className="w-full bg-gradient-to-r from-indigo-50/50 to-violet-50/50 border border-indigo-100 rounded-2xl p-6">
                <div className="flex gap-3 max-w-[600px] mx-auto">
                    <div className="flex-1">
                        <div className="bg-white border border-slate-200 rounded-2xl p-5 text-sm shadow-sm flex items-center gap-4">
                            <div className="flex-shrink-0">
                                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
                                    <User size={16} />
                                </div>
                            </div>
                            <div className="flex-1">
                                <p className="font-bold text-[10px] text-slate-400 mb-1 uppercase tracking-wide">User Question</p>
                                <p className="text-slate-700 leading-relaxed">{query}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="h-full flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl shadow-sm border border-indigo-100 text-indigo-900">
                <Columns size={20} />
                <h2 className="font-bold">Comparison Mode (Contrast View)</h2>
                <div className="ml-auto flex gap-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <span className="flex items-center gap-1"><EyeOff size={14} /> Base Model</span>
                    <span className="flex items-center gap-1"><Eye size={14} className="text-indigo-600" /> Watermarked</span>
                </div>
            </div>

            {/* Scores Header */}
            {evaluationResult && (
                <div className="grid grid-cols-2 gap-6 px-2">
                    <div className="flex justify-center">
                        <span className="text-xs font-bold text-slate-500 bg-white px-3 py-1 rounded border border-slate-200 shadow-sm">
                            Score: {evaluationResult.model_a_score.toFixed(1)}
                        </span>
                    </div>
                    <div className="flex justify-center">
                        <span className="text-xs font-bold text-indigo-600 bg-white px-3 py-1 rounded border border-indigo-100 shadow-sm">
                            Score: {evaluationResult.model_b_score.toFixed(1)}
                        </span>
                    </div>
                </div>
            )}

            {/* Main Content - Single scrollable container with aligned segments */}
            <div 
                className="flex-1 overflow-y-auto bg-slate-50 rounded-2xl scrollbar-thin scrollbar-thumb-slate-200"
                ref={scrollRef}
                onScroll={handleScroll}
            >
                {/* Column Headers - Fixed at top */}
                <div className="sticky top-0 bg-slate-50 z-20 px-4 pt-4 pb-2">
                    <div className="grid grid-cols-2 gap-6">
                        <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-sm">
                            <span className="font-bold text-slate-600 text-sm">Original (Base)</span>
                        </div>
                        <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl shadow-sm">
                            <span className="font-bold text-indigo-700 text-sm">Ours (Watermarked)</span>
                        </div>
                    </div>
                </div>

                {/* Content area with padding */}
                <div className="px-4 pb-4">
                    {/* Initial User Query - Aligned in center */}
                    {userQuery && renderUserQuery(userQuery, 'initial-query')}

                    {/* Render segments */}
                    {segments.map((segment, segIndex) => {
                        // 计算当前 segment 之前的累计步骤数
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
                                            />
                                        ))
                                    ) : (
                                        <div className="text-center text-slate-400 text-sm py-8 italic">
                                            (No more steps)
                                        </div>
                                    )}
                                </div>

                                {/* Right: Watermarked steps */}
                                <div className="space-y-4 p-2 bg-white rounded-xl border border-indigo-100">
                                    {segment.watermarkedSteps.length > 0 ? (
                                        segment.watermarkedSteps.map((step, stepIdx) => (
                                            <StepCard
                                                key={`wm-${segIndex}-${stepIdx}`}
                                                step={step}
                                                isErased={erasedIndices.has(step.stepIndex)}
                                                showWatermarkDetails={true}
                                                displayIndex={prevWatermarkedCount + stepIdx + 1}
                                            />
                                        ))
                                    ) : (
                                        <div className="text-center text-slate-400 text-sm py-8 italic">
                                            (No more steps)
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* User Input - Centered and aligned */}
                            {segment.userInput && renderUserQuery(segment.userInput.thought, `user-input-${segIndex}`)}
                        </React.Fragment>
                    )})}

                    <div ref={bottomRef} className="h-4" />
                </div>
            </div>
        </div>
    );
};

export default ComparisonView;
