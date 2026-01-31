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
    variant?: 'default' | 'add_agent';
    onReEvaluate?: () => void;
    error?: string | null;
}

const EvaluationModal: React.FC<EvaluationModalProps> = ({ isOpen, onClose, result, isLoading, variant = 'default', onReEvaluate, error }) => {
    const { locale } = useI18n();
    const isAddAgent = variant === 'add_agent';

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
                {/* Header */}
                <div className="bg-slate-50 p-6 flex justify-between items-center border-b border-slate-200">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${error ? 'bg-red-100' : isAddAgent ? 'bg-amber-100' : 'bg-indigo-100'}`}>
                            {error ? (
                                <AlertCircle size={24} className="text-red-500" />
                            ) : (
                                <Award size={24} className={isAddAgent ? 'text-amber-500' : 'text-indigo-500'} />
                            )}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold tracking-tight text-slate-800">
                                {error
                                    ? (locale === 'zh' ? '评估失败' : 'Evaluation Failed')
                                    : (locale === 'zh' ? 'AI 评估报告' : 'AI Evaluation Report')
                                }
                            </h2>
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
                            <div className={`w-12 h-12 border-4 rounded-full animate-spin ${isAddAgent ? 'border-amber-100 border-t-amber-300' : 'border-indigo-100 border-t-indigo-300'}`}></div>
                            <p className="text-slate-500 font-medium animate-pulse">{locale === 'zh' ? '正在分析轨迹...' : 'Analyzing trajectories...'}</p>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center py-8 gap-4 text-center">
                            <div className="p-4 rounded-full bg-red-50 text-red-500">
                                <AlertCircle size={48} />
                            </div>
                            <div className="space-y-2 max-w-md">
                                <h3 className="text-lg font-bold text-slate-800">
                                    {locale === 'zh' ? '无法完成评估' : 'Evaluation Error'}
                                </h3>
                                <p className="text-slate-600 text-sm">
                                    {error}
                                </p>
                            </div>
                            <div className="mt-4">
                                {onReEvaluate && (
                                    <button
                                        onClick={onReEvaluate}
                                        className="px-4 py-2 text-white bg-red-500 rounded-lg text-sm font-medium hover:bg-red-600 transition-all hover:shadow-sm active:scale-95 flex items-center gap-2"
                                    >
                                        <Award size={16} />
                                        {locale === 'zh' ? '重试' : 'Retry'}
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : result ? (
                        <div className="space-y-8">
                            {/* Score Comparison */}
                            <div className="grid grid-cols-2 gap-6">
                                {/* Model A (Baseline) */}
                                <div className={`rounded-xl p-6 border flex flex-col items-center gap-3 relative overflow-hidden group transition-colors ${isAddAgent
                                    ? 'bg-amber-100/30 border-amber-200/40 hover:border-amber-300/60'
                                    : 'bg-indigo-100/30 border-indigo-200/40 hover:border-indigo-300/60'
                                    }`}>
                                    <div className={`absolute top-0 left-0 w-full h-1 ${isAddAgent ? 'bg-amber-300/50' : 'bg-indigo-300/50'
                                        }`}></div>
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
                                <div className={`rounded-xl p-6 border flex flex-col items-center gap-3 relative overflow-hidden group transition-colors ${isAddAgent
                                    ? 'bg-amber-100/40 border-amber-200/50 hover:border-amber-300/70'
                                    : 'bg-indigo-100/40 border-indigo-200/50 hover:border-indigo-300/70'
                                    }`}>
                                    <div className={`absolute top-0 left-0 w-full h-1 ${isAddAgent ? 'bg-amber-400/60' : 'bg-indigo-400/60'
                                        }`}></div>
                                    <span className={`text-sm font-bold uppercase tracking-widest ${isAddAgent ? 'text-amber-500' : 'text-indigo-500'
                                        }`}>{locale === 'zh' ? '有水印Agent' : 'Ours (Watermarked)'}</span>
                                    <div className={`text-5xl font-black font-mono tracking-tighter ${isAddAgent ? 'text-amber-600' : 'text-indigo-600'
                                        }`}>
                                        {result.model_b_score}<span className={`text-2xl ${isAddAgent ? 'text-amber-300' : 'text-indigo-300'
                                            }`}>/10</span>
                                    </div>
                                    {result.model_b_score > result.model_a_score && (
                                        <div className={`absolute top-3 right-3 px-2 py-1 rounded text-xs font-bold flex items-center gap-1 ${isAddAgent ? 'text-amber-600 bg-amber-100/70' : 'text-indigo-600 bg-indigo-100/70'
                                            }`}>
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
                <div className="bg-slate-50 p-4 border-t border-slate-200 flex justify-end gap-3">
                    {onReEvaluate && (
                        <button
                            onClick={onReEvaluate}
                            disabled={isLoading}
                            className="px-4 py-2 text-slate-600 bg-white border border-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 transition-all hover:shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            <Award size={16} />
                            {locale === 'zh' ? '重新评估' : 'Re-evaluate'}
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className={`px-6 py-2 text-white rounded-lg font-medium shadow-sm transition-all hover:shadow-md active:scale-95 ${isAddAgent ? 'bg-amber-500 hover:bg-amber-600' : 'bg-indigo-500 hover:bg-indigo-600'
                            }`}
                    >
                        {locale === 'zh' ? '关闭报告' : 'Close Report'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EvaluationModal;
