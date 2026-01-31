import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, FileDigit, Database, Lock, CheckCircle2 } from 'lucide-react';
import type { Step } from '../../types';
import { useI18n } from '../../i18n/I18nContext';

interface RLNCDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    step: Step | null;
    displayIndex: number;
    isErased: boolean;
}

const RLNCDetailModal: React.FC<RLNCDetailModalProps> = ({ isOpen, onClose, step, displayIndex, isErased }) => {
    const { locale } = useI18n();

    if (!step) return null;

    // Helper to visualize matrix row as a grid
    const renderMatrixRow = (row: number[], rowIndex: number) => (
        <div key={rowIndex} className="flex flex-col gap-1 mb-4 p-3 bg-slate-50 rounded-xl border border-slate-100">
            <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-slate-500 font-mono">ROW #{rowIndex} ({locale === 'zh' ? '系数向量' : 'Coefficient Vector'})</span>
                <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-mono">
                    {row.length}-bit
                </span>
            </div>

            {/* Visual Grid */}
            <div className="flex gap-1 mb-2">
                {row.map((bit, idx) => (
                    <div
                        key={idx}
                        className={`h-8 flex-1 rounded-md flex items-center justify-center text-[10px] font-bold font-mono transition-all
                            ${bit ? 'bg-indigo-500 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-300'}`}
                    >
                        {bit}
                    </div>
                ))}
            </div>

            {/* Binary String */}
            <div className="text-[10px] font-mono text-slate-400 text-right">
                Vector: {row.join('')}
            </div>
        </div>
    );

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                    />

                    {/* Modal Content */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden relative z-10"
                    >
                        {/* Header */}
                        <div className={`p-6 border-b flex items-start justify-between ${isErased ? 'bg-rose-50 border-rose-100' : 'bg-white border-slate-100'}`}>
                            <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-sm ${isErased ? 'bg-white text-rose-400' : 'bg-indigo-50 text-indigo-600'}`}>
                                    {isErased ? <Database size={24} /> : <FileDigit size={24} />}
                                </div>
                                <div>
                                    <h2 className={`text-xl font-bold ${isErased ? 'text-rose-600' : 'text-slate-800'}`}>
                                        {locale === 'zh' ? `日志 #${displayIndex}` : `Log #${displayIndex}`}
                                    </h2>
                                    <div className="flex items-center gap-2 mt-1">
                                        {isErased ? (
                                            <span className="flex items-center gap-1 text-xs font-bold text-rose-500 bg-rose-100 px-2 py-0.5 rounded-full">
                                                <Lock size={10} /> {locale === 'zh' ? '数据丢失' : 'LOST PACKET'}
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">
                                                <CheckCircle2 size={10} /> {locale === 'zh' ? '已接收' : 'RECEIVED'}
                                            </span>
                                        )}
                                        <span className="text-xs text-slate-400 font-mono">
                                            {new Date().toLocaleTimeString()}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 max-h-[60vh] overflow-y-auto">
                            {!isErased ? (
                                <div className="space-y-6">
                                    <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
                                        <h3 className="text-sm font-bold text-indigo-900 mb-2">
                                            {locale === 'zh' ? 'RLNC 编码详情' : 'RLNC Encoding Details'}
                                        </h3>
                                        <p className="text-xs text-indigo-700 leading-relaxed">
                                            {locale === 'zh'
                                                ? `本条日志包含 ${step.watermark.matrixRows[0]?.length || 'N'} 维随机系数向量和编码符号，该向量用于高斯消元解码并贡献秩 (Rank)。`
                                                : `This packet contains a ${step.watermark.matrixRows[0]?.length || 'N'}-dimensional random coefficient vector and an encoded symbol. This vector contributes to the rank accumulation in the Gaussian elimination decoding process.`}
                                        </p>
                                    </div>

                                    <div>
                                        <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                                            {locale === 'zh' ? '系数矩阵 / 向量' : 'Coefficient Matrix / Vector'}
                                        </h4>

                                        {step.watermark.matrixRows.map((row, idx) => renderMatrixRow(row, idx))}

                                        {step.watermark.matrixRows.length === 0 && (
                                            <div className="text-center p-8 text-slate-400 text-sm italic border-2 border-dashed border-slate-100 rounded-xl">
                                                {locale === 'zh'
                                                    ? '本次采样未嵌入比特。原因：差分采样（Differential Sampling）选中的概率分箱中仅包含唯一的候选行为，不存在可选空间，故无法携带水印信息。'
                                                    : 'No bits embedded. Reason: The probability bin selected by Differential Sampling contains only unique candidate action, offering no optional space to carry watermark information.'}
                                            </div>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                            <div className="text-xs text-slate-400 mb-1">{locale === 'zh' ? '秩贡献' : 'Rank Contrib.'}</div>
                                            <div className="text-lg font-bold text-slate-700 font-mono">
                                                +{step.watermark.matrixRows.length}
                                            </div>
                                        </div>
                                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                            <div className="text-xs text-slate-400 mb-1">{locale === 'zh' ? '载荷比特' : 'Payload Bits'}</div>
                                            <div className="text-lg font-bold text-slate-700 font-mono truncated truncate" title={step.watermark.bits}>
                                                {step.watermark.bits || "N/A"}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-12">
                                    <div className="w-16 h-16 bg-rose-50 text-rose-300 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <Lock size={32} />
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-800 mb-2">{locale === 'zh' ? '数据擦除' : 'Packet Erasure'}</h3>
                                    <p className="text-slate-500 text-sm max-w-xs mx-auto">
                                        {locale === 'zh'
                                            ? '日志在传输中丢失（或被模拟标记为擦除），无法提取系数向量。'
                                            : 'This packet was lost during transmission (or marked as erased by simulation). Coefficient vectors cannot be extracted.'}
                                    </p>
                                </div>
                            )}
                        </div>

                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default RLNCDetailModal;
