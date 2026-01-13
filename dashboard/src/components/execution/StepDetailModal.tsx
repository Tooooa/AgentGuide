
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine, CartesianGrid } from 'recharts';
import { X, RotateCcw, ArrowRight, Play } from 'lucide-react';
import type { Step } from '../../data/mockData';
import { useI18n } from '../../i18n/I18nContext';
import { roundNormalizedProbsToSumOne } from '../../utils/probability';

const RANK_COLORS = [
    '#f87171', // Red
    '#fbbf24', // Amber
    '#34d399', // Emerald
    '#60a5fa', // Blue
    '#818cf8', // Indigo
    '#a78bfa', // Violet
    '#f472b6', // Pink
];

const MAX_ACTIONS_IN_DETAIL_CHART = 12;
const MAX_REFERENCE_LINES = 12;

interface StepDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    step: Step;
    mode?: 'watermarked' | 'baseline';
}

const StepDetailModal: React.FC<StepDetailModalProps> = ({ isOpen, onClose, step, mode = 'watermarked' }) => {
    const { t } = useI18n();

    if (!isOpen) return null;

    // --- Animation State ---
    const [visibleLayers, setVisibleLayers] = useState(0);
    const [flyingLayer] = useState<number | null>(null); // Index of layer currently flying
    const [isAnimating, setIsAnimating] = useState(false);
    const [chartsReady, setChartsReady] = useState(false);

    // Layout Refs for coordinate calculation
    const leftChartRef = useRef<HTMLDivElement>(null);
    const rightChartRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // --- Data Preparation ---
    const { sortedDist, decompositionData, binsData } = React.useMemo(() => {
        const sortedAll = [...step.distribution].sort((a, b) => b.prob - a.prob);

        // Performance: cap chart items and aggregate tail into a single "Other" bucket.
        let sorted = sortedAll;
        if (sortedAll.length > MAX_ACTIONS_IN_DETAIL_CHART) {
            const selected = sortedAll.find((d) => d.isSelected);
            const keep = sortedAll.slice(0, MAX_ACTIONS_IN_DETAIL_CHART - 1);
            if (selected && !keep.includes(selected)) {
                keep[keep.length - 1] = selected;
            }

            const keptNames = new Set(keep.map((d) => d.name));
            const otherProb = sortedAll
                .filter((d) => !keptNames.has(d.name))
                .reduce((acc, d) => acc + d.prob, 0);

            const other = { name: 'Other', prob: otherProb, isSelected: false };
            sorted = [...keep, other].sort((a, b) => b.prob - a.prob);
        }

        const rounded = roundNormalizedProbsToSumOne(sorted.map((d) => d.prob), 3);
        const sortedRounded = sorted.map((d, i) => ({ ...d, prob: rounded[i] }));

        const bins = sortedRounded.map((d, k) => { // k is 0-indexed here (Rank k+1)
            const nextProb = sortedRounded[k + 1]?.prob || 0;
            const diff = d.prob - nextProb;

            if (diff <= 0.000001) return null; // Skip empty bins

            const binObj: any = {
                name: `T_${k + 1}`,
                totalWeight: (k + 1) * diff,
                k: k + 1,
                isTarget: d.isSelected,
            };

            // Add stacking components
            // For j=0 to k: component "Action_{j+1}" = diff
            for (let j = 0; j <= k; j++) {
                binObj[`Action_${j + 1}`] = diff;
            }

            return binObj;
        }).filter(b => b !== null);

        return {
            sortedDist: sortedRounded,
            decompositionData: sortedRounded,
            binsData: bins
        };
    }, [step]);

    // Reset and start animation when opened
    useEffect(() => {
        if (isOpen) {
            setChartsReady(false);
            // Delay mounting heavy charts until after the modal transition/layout settles.
            requestAnimationFrame(() => requestAnimationFrame(() => setChartsReady(true)));
            // Default: render all layers at once (no incremental animation) to avoid UI jank on open.
            setVisibleLayers(sortedDist.length);
            setIsAnimating(false);
        }
    }, [isOpen, step, sortedDist.length]);

    // Animation Effect
    useEffect(() => {
        if (!isAnimating) return;

        if (visibleLayers >= sortedDist.length) {
            setIsAnimating(false);
            return;
        }

        const timer = setTimeout(() => {
            setVisibleLayers(prev => prev + 1);
        }, 200); // Speed: 200ms per layer

        return () => clearTimeout(timer);
    }, [visibleLayers, isAnimating, sortedDist.length]);

    const handleReplay = () => {
        setVisibleLayers(0);
        setIsAnimating(true);
    };

    // Colors for Ranks (Stack layers)
    const getRankColor = (rankIndex: number) => {
        return RANK_COLORS[rankIndex % RANK_COLORS.length];
    };

    // Calculate flight coordinates
    const getFlyingParticleStyle = (layerIndex: number) => {
        if (!containerRef.current || !leftChartRef.current || !rightChartRef.current) return null;

        const containerRect = containerRef.current.getBoundingClientRect();
        const leftRect = leftChartRef.current.getBoundingClientRect();
        const rightRect = rightChartRef.current.getBoundingClientRect();

        // Start Position (Left Chart):
        // Estimate bar position: evenly distributed
        const barWidthApprx = leftRect.width / sortedDist.length;
        // Approximation: Align with the i-th bar
        const startX = (leftRect.left - containerRect.left) + (layerIndex * barWidthApprx) + (barWidthApprx / 2) + 30;

        // Start Y: roughly corresponds to height
        const maxProb = sortedDist[0].prob;
        const prob = sortedDist[layerIndex].prob;
        const graphHeight = leftRect.height - 40; // minus padding
        const barHeight = (prob / maxProb) * graphHeight;
        const startY = (leftRect.bottom - containerRect.top) - barHeight - 20;

        // End Position (Right Chart):
        // Center of right chart
        const endX = (rightRect.left - containerRect.left) + (rightRect.width / 2);

        // Stack Top Y
        let stackHeightProb = 0;
        for (let i = 0; i < layerIndex; i++) {
            // Calculate accumulated height based on generic logic
            const prevProb = sortedDist[i].prob;
            const nextProb = sortedDist[i + 1]?.prob || 0;
            const diff = prevProb - nextProb;
            stackHeightProb += (i + 1) * diff;
        }

        // Normalize stack height. 
        // Max theoretical height is related to the sum of all components? 
        // Note: the right chart Y-axis scale might be different. 
        // Let's assume the right chart fills the height similar to YAxis domain 0-1 (usually).
        // If max sum > 0.1, it scales. 
        // Let's just fly to "bottom + offset" growing up.
        // Simplified: Fly to bottom and stack up visually.
        const endY = (rightRect.bottom - containerRect.top) - (stackHeightProb / (sortedDist[0].prob * 1.5)) * graphHeight - 20; // Heuristic scaling

        return {
            startX,
            startY,
            endX,
            endY,
            color: getRankColor(layerIndex)
        };
    };

    const particleConfig = flyingLayer !== null ? getFlyingParticleStyle(flyingLayer) : null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="flex justify-between items-center p-6 border-b border-slate-100">
                        <div>
                            <h2 className="text-xl font-bold text-slate-800">
                                {mode === 'watermarked' ? t('diffSamplingViz') : t('randomSamplingViz')}
                            </h2>
                            <p className="text-sm text-slate-500">{t('step')} #{step.stepIndex}: {step.thought.substring(0, 80)}...</p>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                            <X size={24} className="text-slate-500" />
                        </button>
                    </div>

                    {/* Content */}
                      <div className="flex-1 overflow-y-scroll p-6 bg-slate-50/50" ref={containerRef}>
                          <div className="flex gap-4 h-[500px]">
                              {/* Left Chart: Decomposition or Single Distribution */}
                                <div className={`flex-1 bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col ${mode === 'baseline' ? 'max-w-3xl mx-auto w-full' : ''}`} ref={leftChartRef}>
                                    <h3 className="text-sm font-bold text-slate-600 mb-4 uppercase tracking-wider text-center">
                                        {mode === 'watermarked' ? t('probDecomp') : t('probDist')}
                                    </h3>
                                    <div className="flex-1 relative">
                                        {!chartsReady ? (
                                            <div className="w-full h-full bg-slate-50 rounded-lg animate-pulse" />
                                        ) : (
                                        <ResponsiveContainer width="100%" height="100%" debounce={100}>
                                            <BarChart data={decompositionData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                <XAxis
                                                    dataKey="name"
                                                    tick={{ fontSize: 10 }}
                                                  interval={decompositionData.length > 10 ? Math.ceil(decompositionData.length / 10) - 1 : 0}
                                                  angle={-45}
                                                  textAnchor="end"
                                                  height={60}
                                              />
                                              <YAxis tickFormatter={(v) => Number(v).toFixed(3)} />
                                              <Tooltip content={({ active, payload, label }) => {
                                                  if (active && payload && payload.length) {
                                                      const item: any = payload[0].payload;
                                                      const prob = Number(item.prob);
                                                      return (
                                                          <div className="bg-white/95 backdrop-blur shadow-xl border border-slate-200 p-3 rounded-lg text-xs">
                                                              <p className="font-bold mb-1 text-slate-800">{label}</p>
                                                              <p className="font-mono">Prob: {prob.toFixed(3)}</p>
                                                          </div>
                                                      );
                                                  }
                                                  return null;
                                              }} />
                                              {/* Slicing Lines (Only for Watermarked/Diff) */}
                                              {mode === 'watermarked' && decompositionData.slice(0, MAX_REFERENCE_LINES).map((d, i) => (
                                                  <ReferenceLine key={`line-${i}`} y={d.prob} stroke="#94a3b8" strokeDasharray="4 4" label={{ position: 'right', value: `P${i + 1}`, fontSize: 10, fill: '#94a3b8' }} />
                                              ))}
                                                <Bar dataKey="prob" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                                                    {decompositionData.map((_, i) => (
                                                        <Cell key={i} fill={getRankColor(i)} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                        )}
                                    </div>
                                </div>

                            {/* Right Section (Only for Watermarked) */}
                            {mode === 'watermarked' && (
                                <>
                                    {/* Arrow */}
                                    <div className="flex items-center justify-center text-slate-300">
                                        <ArrowRight size={48} />
                                    </div>

                                      {/* Right Chart: Recombination */}
                                      <div className="flex-1 bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col" ref={rightChartRef}>
                                          <h3 className="text-sm font-bold text-slate-600 mb-4 uppercase tracking-wider text-center">
                                              {t('recombination')}
                                              {!isAnimating && visibleLayers >= sortedDist.length && (
                                                <button
                                                    onClick={handleReplay}
                                                    className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 transition-colors"
                                                    title={t('replay')}
                                                >
                                                    <Play size={10} fill="currentColor" /> {t('replay')}
                                                </button>
                                            )}
                                          </h3>
                                          <div className="flex-1 relative">
                                              {!chartsReady ? (
                                                  <div className="w-full h-full bg-slate-50 rounded-lg animate-pulse" />
                                              ) : (
                                              <ResponsiveContainer width="100%" height="100%" debounce={100}>
                                                  <BarChart data={binsData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                                                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                      <XAxis dataKey="name" />
                                                      <YAxis />
                                                      <Tooltip cursor={{ fill: 'transparent' }} content={({ active, payload, label }) => {
                                                        if (active && payload && payload.length) {
                                                            const bin = payload[0].payload;
                                                            return (
                                                                <div className="bg-white/95 backdrop-blur shadow-xl border border-slate-200 p-3 rounded-lg text-xs">
                                                                    <p className="font-bold mb-2 text-base text-slate-800">{label}</p>
                                                                    <div className="space-y-1">
                                                                        <p className="flex justify-between gap-4"><span>Total Weight:</span> <span className="font-mono font-bold">{bin.totalWeight.toFixed(4)}</span></p>
                                                                        <p className="flex justify-between gap-4"><span>Bin Size (K):</span> <span className="font-mono">{bin.k}</span></p>
                                                                        <div className="border-t border-slate-100 my-1 pt-1">
                                                                            <p className="font-semibold text-slate-500 mb-1">Contains parts from:</p>
                                                                            {sortedDist.slice(0, bin.k).map((d, idx) => (
                                                                                <div key={idx} className="flex items-center gap-2">
                                                                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getRankColor(idx) }}></div>
                                                                                    <span className="truncate max-w-[150px]">{d.name}</span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    }} />

                                                    {/* Render Stacked Bars - Animated */}
                                                    {/* We stack up to max K. Max K is sortedDist.length */}
                                                      {sortedDist.slice(0, visibleLayers).map((_, i) => (
                                                          <Bar
                                                              key={`stack-${i}`}
                                                              dataKey={`Action_${i + 1}`}
                                                              stackId="a"
                                                              fill={getRankColor(i)}
                                                              stroke="white"
                                                              strokeWidth={1}
                                                              isAnimationActive={false}
                                                          />
                                                      ))}

                                                  </BarChart>
                                              </ResponsiveContainer>
                                              )}
                                          </div>
                                      </div>
                                  </>
                              )}
                          </div>

                    </div>

                    {/* Flying Particle (Only if in watermarked mode and config exists) */}
                    <AnimatePresence>
                        {mode === 'watermarked' && particleConfig && flyingLayer !== null && (
                            <motion.div
                                key={`fly-${flyingLayer}`}
                                initial={{
                                    left: particleConfig.startX,
                                    top: particleConfig.startY,
                                    opacity: 0.8,
                                    scale: 1,
                                    width: 40, // Fixed width particle
                                    height: 20
                                }}
                                animate={{
                                    left: particleConfig.endX,
                                    top: particleConfig.endY,
                                    opacity: [0.8, 1, 0] // Fade out at end
                                }}
                                transition={{ duration: 0.5, ease: "easeInOut" }}
                                style={{
                                    position: 'absolute',
                                    backgroundColor: particleConfig.color,
                                    borderRadius: 4,
                                    zIndex: 60,
                                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                                }}
                            />
                        )}
                    </AnimatePresence>

                    {/* Explanation Text */}
                    <div className="mt-6 p-4 bg-indigo-50/50 rounded-xl border border-indigo-100 text-sm text-slate-600 space-y-2">
                        <h4 className="font-bold text-indigo-800 flex items-center gap-2">
                            <RotateCcw size={16} /> {mode === 'watermarked' ? t('howDiffWorks') : t('howRandomWorks')}
                        </h4>
                        {mode === 'watermarked' ? (
                            <>
                                <p><strong>1.</strong> {t('diffStep1')}</p>
                                <p><strong>2.</strong> {t('diffStep2')}</p>
                                <p><strong>3.</strong> {t('diffStep3')}</p>
                            </>
                        ) : (
                            <>
                                <p><strong>1.</strong> {t('randomStep1')}</p>
                                <p><strong>2.</strong> {t('randomStep2')}</p>
                                <p><strong>3.</strong> {t('randomStep3')}</p>
                            </>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence >
    );
};

export default StepDetailModal;
