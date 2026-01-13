import React, { useRef, useEffect } from 'react';

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

const ComparisonView: React.FC<ComparisonViewProps> = ({ visibleSteps, erasedIndices, scenarioId, evaluationResult, userQuery }) => {

    const scrollRefA = useRef<HTMLDivElement>(null);
    const scrollRefB = useRef<HTMLDivElement>(null);
    const bottomRefA = useRef<HTMLDivElement>(null);
    const bottomRefB = useRef<HTMLDivElement>(null);
    const isAtBottomRef = useRef(true); // Track user scroll position

    // Reset scroll to bottom when scenario changes
    useEffect(() => {
        isAtBottomRef.current = true;
        bottomRefA.current?.scrollIntoView({ behavior: 'auto' });
        bottomRefB.current?.scrollIntoView({ behavior: 'auto' });
    }, [scenarioId]);

    // Smart auto-scroll when steps change
    useEffect(() => {
        if (visibleSteps.length > 0 && isAtBottomRef.current) {
            bottomRefA.current?.scrollIntoView({ behavior: 'smooth' });
            bottomRefB.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [visibleSteps]);

    // Manually handle scroll sync? For now, we just auto-scroll both.
    // Implementing true bi-directional sync scroll is complex without custom hooks, 
    // but the requirement says "Sync Scrolling".

    const handleScroll = (source: 'A' | 'B') => {
        const sourceRef = source === 'A' ? scrollRefA : scrollRefB;
        const targetRef = source === 'A' ? scrollRefB : scrollRefA;

        if (sourceRef.current && targetRef.current) {
            // Check if at bottom (using source)
            const { scrollTop, scrollHeight, clientHeight } = sourceRef.current;
            isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 50;

            // Verify if we should sync (avoid loops) - rough implementation
            // targetRef.current.scrollTop = ratio * (targetRef.current.scrollHeight - targetRef.current.clientHeight);
            // Actually, since content is identical length mostly, direct scrollTop copy is better
            targetRef.current.scrollTop = sourceRef.current.scrollTop;
        }
    };

    return (
        <div className="h-full flex flex-col gap-4">
            <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl shadow-sm border border-indigo-100 text-indigo-900">
                <Columns size={20} />
                <h2 className="font-bold">Comparison Mode (Contrast View)</h2>
                <div className="ml-auto flex gap-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <span className="flex items-center gap-1"><EyeOff size={14} /> Base Model</span>
                    <span className="flex items-center gap-1"><Eye size={14} className="text-indigo-600" /> Watermarked</span>
                </div>
            </div>

            <div className="flex-1 grid grid-cols-2 gap-6 min-h-0">
                {/* Left: No Watermark */}
                <div className="flex flex-col gap-2 rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-sm">
                    <div className="p-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                        <span className="font-bold text-slate-600 text-sm">Original (Base)</span>
                        {evaluationResult && (
                            <span className="text-xs font-bold text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200 shadow-sm">
                                Score: {evaluationResult.model_a_score.toFixed(1)}
                            </span>
                        )}
                    </div>
                    <div
                        className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-200"
                        ref={scrollRefA}
                        onScroll={() => handleScroll('A')}
                    >
                        {/* Initial User Query */}
                        {userQuery && (
                            <div className="flex justify-end pr-2 mb-4">
                                <div className="flex gap-3 flex-row-reverse max-w-[85%]">
                                    <div className="flex-shrink-0 mt-1">
                                        <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
                                            <User size={14} />
                                        </div>
                                    </div>
                                    <div className="flex-1 text-right">
                                        <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl rounded-tr-none p-3 text-white text-xs shadow-md inline-block text-left">
                                            <p className="font-bold text-[9px] text-indigo-100 mb-1 uppercase tracking-wide">User Prompt</p>
                                            {userQuery}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        {visibleSteps.map((step) => {
                            // Construct Baseline Step Object if available
                            const baselineStep: Step = step.baseline ? {
                                ...step,
                                thought: step.baseline.thought,
                                action: step.baseline.action,
                                toolDetails: step.baseline.toolDetails, // Ensure property name matches Step type
                                distribution: step.baseline.distribution,
                                stepType: step.baseline.stepType,
                                finalAnswer: step.baseline.finalAnswer,
                                watermark: { bits: "", matrixRows: [], rankContribution: 0 },
                                metrics: undefined // Baseline metrics might not be tracked or need separate field?
                            } : step;

                            // Skip rendering if baseline step is hidden
                            if (baselineStep.isHidden) return null;

                            return (
                                <StepCard
                                    key={`nw-${step.stepIndex}`}
                                    step={baselineStep}
                                    isErased={false}
                                    showWatermarkDetails={false}
                                    showDistribution={true}
                                />
                            );
                        })}
                        <div ref={bottomRefA} className="h-4" />
                    </div>
                </div>

                {/* Right: Watermarked */}
                <div className="flex flex-col gap-2 rounded-2xl bg-white border border-indigo-200 overflow-hidden shadow-md ring-1 ring-indigo-50">
                    <div className="p-3 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between">
                        <span className="font-bold text-indigo-700 text-sm flex items-center gap-2">
                            Ours (Watermarked)
                        </span>
                        {evaluationResult && (
                            <span className="text-xs font-bold text-indigo-600 bg-white px-2 py-0.5 rounded border border-indigo-100 shadow-sm">
                                Score: {evaluationResult.model_b_score.toFixed(1)}
                            </span>
                        )}
                    </div>
                    <div
                        className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-indigo-100"
                        ref={scrollRefB}
                        onScroll={() => handleScroll('B')}
                    >
                        {/* Initial User Query */}
                        {userQuery && (
                            <div className="flex justify-end pr-2 mb-4">
                                <div className="flex gap-3 flex-row-reverse max-w-[85%]">
                                    <div className="flex-shrink-0 mt-1">
                                        <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
                                            <User size={14} />
                                        </div>
                                    </div>
                                    <div className="flex-1 text-right">
                                        <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl rounded-tr-none p-3 text-white text-xs shadow-md inline-block text-left">
                                            <p className="font-bold text-[9px] text-indigo-100 mb-1 uppercase tracking-wide">User Prompt</p>
                                            {userQuery}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        {visibleSteps.map((step) => {
                            if (step.isHidden) return null;
                            return (
                                <StepCard
                                    key={`wm-${step.stepIndex}`}
                                    step={step}
                                    isErased={erasedIndices.has(step.stepIndex)}
                                    showWatermarkDetails={true}
                                />
                            );
                        })}
                        <div ref={bottomRefB} className="h-4" />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ComparisonView;
