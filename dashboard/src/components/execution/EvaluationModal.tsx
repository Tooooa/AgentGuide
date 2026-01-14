import React from 'react';
import { X, Award, CheckCircle, AlertCircle } from 'lucide-react';

import { useI18n } from '../../i18n/I18nContext';

interface EvaluationResult {
    model_a_score: number;
    model_b_score: number;
    reason: string;
}

interface EvaluationModalProps {
    isOpen: boolean;
    onClose: () => void;
    result: EvaluationResult | null;
    isLoading: boolean;
}

const EvaluationModal: React.FC<EvaluationModalProps> = ({ isOpen, onClose, result, isLoading }) => {
    const { locale } = useI18n();

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
                {/* Header */}
                <div className="bg-slate-50 p-6 flex justify-between items-center border-b border-slate-200">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 rounded-lg">
                            <Award size={24} className="text-indigo-500" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold tracking-tight text-slate-800">{locale === 'zh' ? 'AI 评估报告' : 'AI Evaluation Report'}</h2>
                            <p className="text-slate-500 text-sm">{locale === 'zh' ? '由 Judge 模型自动分析' : 'Automated analysis by Judge Model'}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-600"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 md:p-8">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-4">
                            <div className="w-12 h-12 border-4 border-indigo-100 border-t-indigo-300 rounded-full animate-spin"></div>
                            <p className="text-slate-500 font-medium animate-pulse">{locale === 'zh' ? '正在分析轨迹...' : 'Analyzing trajectories...'}</p>
                        </div>
                    ) : result ? (
                        <div className="space-y-8">
                            {/* Score Comparison */}
                            <div className="grid grid-cols-2 gap-6">
                                {/* Model A (Baseline) */}
                                <div className="bg-indigo-100/30 rounded-xl p-6 border border-indigo-200/40 flex flex-col items-center gap-3 relative overflow-hidden group hover:border-indigo-300/60 transition-colors">
                                    <div className="absolute top-0 left-0 w-full h-1 bg-indigo-300/50"></div>
                                    <span className="text-sm font-bold text-slate-600 uppercase tracking-widest">{locale === 'zh' ? '无水印Agent' : 'Base Model'}</span>
                                    <div className="text-5xl font-black text-slate-700 font-mono tracking-tighter">
                                        {result.model_a_score}<span className="text-2xl text-slate-400">/10</span>
                                    </div>
                                    {result.model_a_score > result.model_b_score && (
                                        <div className="absolute top-3 right-3 text-emerald-500 bg-emerald-50 px-2 py-1 rounded text-xs font-bold flex items-center gap-1">
                                            <CheckCircle size={12} /> {locale === 'zh' ? '胜出' : 'WINNER'}
                                        </div>
                                    )}
                                </div>

                                {/* Model B (Ours) */}
                                <div className="bg-indigo-100/40 rounded-xl p-6 border border-indigo-200/50 flex flex-col items-center gap-3 relative overflow-hidden group hover:border-indigo-300/70 transition-colors">
                                    <div className="absolute top-0 left-0 w-full h-1 bg-indigo-400/60"></div>
                                    <span className="text-sm font-bold text-indigo-500 uppercase tracking-widest">{locale === 'zh' ? '有水印Agent' : 'Ours (Watermarked)'}</span>
                                    <div className="text-5xl font-black text-indigo-600 font-mono tracking-tighter">
                                        {result.model_b_score}<span className="text-2xl text-indigo-300">/10</span>
                                    </div>
                                    {result.model_b_score > result.model_a_score && (
                                        <div className="absolute top-3 right-3 text-indigo-600 bg-indigo-100/70 px-2 py-1 rounded text-xs font-bold flex items-center gap-1">
                                            <Award size={12} /> {locale === 'zh' ? '胜出' : 'WINNER'}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Reasoning */}
                            <div className="bg-slate-50 rounded-xl p-5 border border-slate-200">
                                <div className="flex items-center gap-2 mb-3 text-slate-700 font-bold border-b border-slate-200 pb-2">
                                    <AlertCircle size={18} />
                                    <h3>{locale === 'zh' ? '评估理由' : 'Evaluation Reasoning'}</h3>
                                </div>
                                <p className="text-slate-600 leading-relaxed text-sm">
                                    {result.reason}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center text-slate-400 py-12">{locale === 'zh' ? '暂无结果。' : 'No result available.'}</div>
                    )}
                </div>

                {/* Footer */}
                <div className="bg-slate-50 p-4 border-t border-slate-200 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg font-medium shadow-sm transition-all hover:shadow-md active:scale-95"
                    >
                        {locale === 'zh' ? '关闭报告' : 'Close Report'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EvaluationModal;
