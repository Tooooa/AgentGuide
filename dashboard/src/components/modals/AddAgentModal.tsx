import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';

interface AddAgentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onApply: (data: { repoUrl: string; apiKey: string }) => void;
    apiKey: string;
    repoUrl: string;
}

const AddAgentModal: React.FC<AddAgentModalProps> = ({
    isOpen,
    onClose,
    onApply,
    apiKey,
    repoUrl
}) => {
    const { locale } = useI18n();
    const [localRepoUrl, setLocalRepoUrl] = React.useState(repoUrl);
    const [localApiKey, setLocalApiKey] = React.useState(apiKey);

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        setLocalRepoUrl(repoUrl);
        setLocalApiKey(apiKey);
    }, [isOpen, repoUrl, apiKey]);

    const handleApply = () => {
        onApply({
            repoUrl: localRepoUrl.trim(),
            apiKey: localApiKey.trim()
        });
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[100]"
                    />

                    <div
                        className="fixed z-[101]"
                        style={{
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)'
                        }}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.92 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.92 }}
                            transition={{ type: "spring", duration: 0.3 }}
                            className="w-[60vw] min-w-[760px] max-w-[980px] bg-white rounded-2xl shadow-2xl overflow-hidden"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-indigo-600 to-violet-600">
                                <h2 className="text-xl font-bold text-white">
                                    {locale === 'zh' ? 'Add Your Agent' : 'Add Your Agent'}
                                </h2>
                                <button
                                    onClick={onClose}
                                    className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
                                >
                                    <X size={20} className="text-white" />
                                </button>
                            </div>

                            <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-2">
                                        {locale === 'zh' ? '仓库地址' : 'Repository URL'}
                                    </label>
                                    <input
                                        type="text"
                                        value={localRepoUrl}
                                        onChange={(e) => setLocalRepoUrl(e.target.value)}
                                        placeholder="https://github.com/your-org/your-agent"
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 outline-none transition-all text-sm font-mono"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-2">
                                        {locale === 'zh' ? 'API Key' : 'API Key'}
                                    </label>
                                    <input
                                        type="password"
                                        value={localApiKey}
                                        onChange={(e) => setLocalApiKey(e.target.value)}
                                        placeholder="sk-..."
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 outline-none transition-all text-sm font-mono"
                                    />
                                </div>

                            </div>

                            <div className="flex items-center justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200">
                                <button
                                    onClick={onClose}
                                    className="px-5 py-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors font-medium"
                                >
                                    {locale === 'zh' ? '取消' : 'Cancel'}
                                </button>
                                <button
                                    onClick={handleApply}
                                    className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 text-white font-medium hover:shadow-lg transition-all"
                                    disabled={!localApiKey.trim()}
                                >
                                    {locale === 'zh' ? '应用' : 'Apply'}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
};

export default AddAgentModal;
