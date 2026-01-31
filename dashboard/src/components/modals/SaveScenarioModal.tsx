
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Save, AlertCircle } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { api } from '../../services/api';
import type { Trajectory } from '../../types';

interface SaveScenarioModalProps {
    isOpen: boolean;
    onClose: () => void;
    scenarioData: Trajectory | null;
    onSaved: () => void;
}

const SaveScenarioModal: React.FC<SaveScenarioModalProps> = ({
    isOpen,
    onClose,
    scenarioData,
    onSaved
}) => {
    const { locale } = useI18n();
    const [title, setTitle] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = async () => {
        if (!title.trim()) {
            setError(locale === 'zh' ? "请输入标题" : "Please enter a title");
            return;
        }
        if (!scenarioData) return;

        setIsSaving(true);
        setError(null);
        try {
            await api.saveScenario(title, scenarioData);
            onSaved();
            onClose();
            setTitle(""); // Reset
        } catch (e) {
            console.error(e);
            setError(locale === 'zh' ? "保存失败，请查看控制台" : "Failed to save, check console");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden ring-1 ring-slate-900/5"
                    >
                        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                <Save size={18} className="text-brand-blue" />
                                {locale === 'zh' ? "保存当前会话" : "Save Current Session"}
                            </h3>
                            <button
                                onClick={onClose}
                                className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-md hover:bg-slate-100"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                    {locale === 'zh' ? "场景标题" : "Scenario Title"}
                                </label>
                                <input
                                    type="text"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder={locale === 'zh' ? "例如：我的测试会话..." : "e.g. My Test Session 1"}
                                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 focus:border-brand-blue focus:ring-1 focus:ring-brand-blue outline-none transition-all placeholder:text-slate-300"
                                    autoFocus
                                />
                            </div>

                            {error && (
                                <div className="text-xs text-red-500 flex items-center gap-1.5 p-2 bg-red-50 rounded-md border border-red-100">
                                    <AlertCircle size={14} />
                                    {error}
                                </div>
                            )}

                            <div className="pt-2 flex justify-end gap-3">
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors font-medium"
                                >
                                    {locale === 'zh' ? "取消" : "Cancel"}
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={isSaving}
                                    className="px-4 py-2 text-sm bg-brand-blue text-white rounded-lg shadow-sm hover:bg-brand-blue-hover active:scale-95 transition-all font-medium flex items-center gap-2"
                                >
                                    {isSaving ? (
                                        <>
                                            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                                            {locale === 'zh' ? "保存中..." : "Saving..."}
                                        </>
                                    ) : (
                                        <>
                                            <Save size={16} />
                                            {locale === 'zh' ? "确认保存" : "Confirm Save"}
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default SaveScenarioModal;
