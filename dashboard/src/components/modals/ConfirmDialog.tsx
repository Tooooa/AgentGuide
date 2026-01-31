import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';

interface ConfirmDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void | Promise<void>;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isDestructive?: boolean;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText,
    cancelText,
    isDestructive = false
}) => {
    const { locale } = useI18n();

    if (!isOpen) return null;

    const handleConfirm = async () => {
        await onConfirm();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
                {/* Header */}
                <div className={`p-6 border-b ${isDestructive ? 'bg-red-50 border-red-100' : 'bg-slate-50 border-slate-100'}`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            {isDestructive && (
                                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                                    <AlertTriangle size={20} className="text-red-600" />
                                </div>
                            )}
                            <h2 className={`text-xl font-bold ${isDestructive ? 'text-red-900' : 'text-slate-900'}`}>
                                {title}
                            </h2>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-slate-400 hover:text-slate-600 transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6">
                    <p className="text-slate-700 leading-relaxed whitespace-pre-line">
                        {message}
                    </p>
                </div>

                {/* Footer */}
                <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3 justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors font-medium"
                    >
                        {cancelText || (locale === 'zh' ? 'Cancel' : 'Cancel')}
                    </button>
                    <button
                        onClick={handleConfirm}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${isDestructive
                            ? 'bg-red-600 hover:bg-red-700 text-white'
                            : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                            }`}
                    >
                        {confirmText || (locale === 'zh' ? 'Confirm' : 'Confirm')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmDialog;
