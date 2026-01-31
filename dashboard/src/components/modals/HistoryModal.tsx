/**
 * Full-screen history modal for viewing and managing conversation history.
 * Extracted from App.tsx for better code organization.
 */
import { useState, useMemo } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import type { Trajectory } from '../../types';
import ConfirmDialog from './ConfirmDialog';


interface HistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    scenarios: Trajectory[];
    activeScenarioId: string;
    onSelectScenario: (scenarioId: string) => void;
    onDeleteScenario: (scenarioId: string) => Promise<void>;
    onClearAllHistory: () => Promise<void>;
    onBatchDeleteScenarios: (ids: string[]) => Promise<{ deleted_count: number }>;
    onTogglePin: (scenarioId: string) => Promise<void>;
}


export default function HistoryModal({
    isOpen,
    onClose,
    scenarios,
    activeScenarioId,
    onSelectScenario,
    onDeleteScenario,
    onClearAllHistory,
    onBatchDeleteScenarios,
    onTogglePin,
}: HistoryModalProps) {
    const { locale } = useI18n();
    const [searchQuery, setSearchQuery] = useState('');
    const [isBatchMode, setIsBatchMode] = useState(false);
    const [selectedScenarios, setSelectedScenarios] = useState<Set<string>>(new Set());
    const [isDeleting, setIsDeleting] = useState(false);
    const [isClearHistoryDialogOpen, setIsClearHistoryDialogOpen] = useState(false);
    const [isBatchDeleteDialogOpen, setIsBatchDeleteDialogOpen] = useState(false);

    // Filter scenarios based on search query
    const filteredScenarios = useMemo(() => {
        if (!searchQuery.trim()) {
            return scenarios;
        }
        const query = searchQuery.toLowerCase();
        return scenarios.filter(scenario => {
            const titleEn = scenario.title.en?.toLowerCase() || '';
            const titleZh = scenario.title.zh?.toLowerCase() || '';
            const userQuery = scenario.userQuery?.toLowerCase() || '';
            return titleEn.includes(query) || titleZh.includes(query) || userQuery.includes(query);
        });
    }, [scenarios, searchQuery]);

    const handleClose = () => {
        setIsBatchMode(false);
        setSelectedScenarios(new Set());
        onClose();
    };

    if (!isOpen) return null;

    return (
        <>
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[80vh] flex flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between p-6 border-b">
                        <h2 className="text-2xl font-bold text-gray-800">
                            {locale === 'zh' ? '历史记录' : 'History'}
                            {isBatchMode && selectedScenarios.size > 0 && (
                                <span className="ml-3 text-sm font-normal text-blue-600">
                                    ({selectedScenarios.size} {locale === 'zh' ? '已选择' : 'selected'})
                                </span>
                            )}
                        </h2>
                        <div className="flex items-center gap-2">
                            {/* Batch Mode Toggle */}
                            {filteredScenarios.length > 0 && !isBatchMode && (
                                <button
                                    onClick={() => {
                                        setIsBatchMode(true);
                                        setSelectedScenarios(new Set());
                                    }}
                                    className="px-3 py-1.5 text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors flex items-center gap-1.5 border border-blue-200"
                                    title={locale === 'zh' ? '批量删除' : 'Batch Delete'}
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                                    </svg>
                                    <span>{locale === 'zh' ? '批量删除' : 'Batch Delete'}</span>
                                </button>
                            )}

                            {/* Batch Mode Actions */}
                            {isBatchMode && (
                                <>
                                    <button
                                        onClick={() => {
                                            if (selectedScenarios.size === filteredScenarios.length) {
                                                setSelectedScenarios(new Set());
                                            } else {
                                                setSelectedScenarios(new Set(filteredScenarios.map(s => s.id)));
                                            }
                                        }}
                                        className="px-3 py-1.5 text-xs text-gray-700 bg-white hover:bg-gray-50 rounded-md transition-colors flex items-center gap-1.5 border border-gray-200"
                                    >
                                        <span>{selectedScenarios.size === filteredScenarios.length
                                            ? (locale === 'zh' ? '取消全选' : 'Deselect All')
                                            : (locale === 'zh' ? '全选' : 'Select All')
                                        }</span>
                                    </button>

                                    <button
                                        onClick={() => {
                                            if (selectedScenarios.size > 0) {
                                                setIsBatchDeleteDialogOpen(true);
                                            }
                                        }}
                                        disabled={selectedScenarios.size === 0}
                                        className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1.5 border ${selectedScenarios.size > 0
                                            ? 'text-red-700 bg-red-50 hover:bg-red-100 border-red-200'
                                            : 'text-gray-400 bg-gray-50 border-gray-200 cursor-not-allowed'
                                            }`}
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                        <span>{locale === 'zh' ? '删除选中' : 'Delete Selected'}</span>
                                    </button>

                                    <button
                                        onClick={() => {
                                            setIsBatchMode(false);
                                            setSelectedScenarios(new Set());
                                        }}
                                        className="px-3 py-1.5 text-xs text-gray-700 bg-white hover:bg-gray-50 rounded-md transition-colors border border-gray-200"
                                    >
                                        {locale === 'zh' ? '取消' : 'Cancel'}
                                    </button>
                                </>
                            )}

                            {/* Clear All Button */}
                            {filteredScenarios.length > 0 && !isBatchMode && (
                                <button
                                    onClick={() => setIsClearHistoryDialogOpen(true)}
                                    className="px-3 py-1.5 text-xs text-gray-700 bg-white hover:bg-gray-50 rounded-md transition-colors flex items-center gap-1.5 border border-gray-200"
                                    title={locale === 'zh' ? '清空所有历史记录' : 'Clear All History'}
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                    <span>{locale === 'zh' ? '清空历史' : 'Clear'}</span>
                                </button>
                            )}

                            <button
                                onClick={handleClose}
                                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                                title={locale === 'zh' ? '关闭' : 'Close'}
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* Search Bar */}
                    <div className="px-6 pt-4 pb-2">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder={locale === 'zh' ? '搜索对话...' : 'Search conversations...'}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                            <svg
                                className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-6">
                        {filteredScenarios.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-gray-400">
                                <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                                </svg>
                                <p className="text-lg font-medium">{locale === 'zh' ? '暂无历史记录' : 'No history'}</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {filteredScenarios.map((scenario) => {
                                    const isSelected = selectedScenarios.has(scenario.id);
                                    return (
                                        <div
                                            key={scenario.id}
                                            className={`p-4 rounded-lg border-2 transition-all hover:shadow-lg relative ${isBatchMode
                                                ? isSelected
                                                    ? 'border-blue-500 bg-blue-50 cursor-pointer'
                                                    : 'border-gray-200 hover:border-blue-300 cursor-pointer'
                                                : scenario.id === activeScenarioId
                                                    ? 'border-blue-500 bg-blue-50 cursor-pointer'
                                                    : 'border-gray-200 hover:border-blue-300 cursor-pointer'
                                                }`}
                                            onClick={() => {
                                                if (isBatchMode) {
                                                    const newSelected = new Set(selectedScenarios);
                                                    if (isSelected) {
                                                        newSelected.delete(scenario.id);
                                                    } else {
                                                        newSelected.add(scenario.id);
                                                    }
                                                    setSelectedScenarios(newSelected);
                                                } else {
                                                    onSelectScenario(scenario.id);
                                                    handleClose();
                                                }
                                            }}
                                        >
                                            {/* Batch Mode Checkbox */}
                                            {isBatchMode && (
                                                <div className="absolute top-2 left-2 z-10">
                                                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${isSelected
                                                        ? 'bg-blue-500 border-blue-500'
                                                        : 'bg-white border-gray-300'
                                                        }`}>
                                                        {isSelected && (
                                                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                            </svg>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Pin Badge */}
                                            {(scenario as any).isPinned && !isBatchMode && (
                                                <div className="absolute top-2 left-2 bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1">
                                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                                                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                                                    </svg>
                                                    {locale === 'zh' ? '置顶' : 'Pinned'}
                                                </div>
                                            )}

                                            <div className="flex items-start justify-between mb-2">
                                                <h3 className={`font-semibold text-gray-800 flex-1 line-clamp-2 ${(scenario as any).isPinned && !isBatchMode ? 'mt-6' : isBatchMode ? 'ml-7' : ''
                                                    }`}>
                                                    {locale === 'zh' ? scenario.title.zh : scenario.title.en}
                                                </h3>
                                                {!isBatchMode && (
                                                    <div className="flex items-center gap-1 ml-2">
                                                        {/* Pin/Unpin Button */}
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onTogglePin(scenario.id);
                                                            }}
                                                            className={`p-1 rounded transition-colors ${(scenario as any).isPinned
                                                                ? 'text-amber-600 hover:bg-amber-50'
                                                                : 'text-gray-400 hover:bg-gray-100 hover:text-amber-600'
                                                                }`}
                                                            title={locale === 'zh' ? ((scenario as any).isPinned ? '取消置顶' : '置顶') : ((scenario as any).isPinned ? 'Unpin' : 'Pin')}
                                                        >
                                                            <svg className="w-4 h-4" fill={(scenario as any).isPinned ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                                                            </svg>
                                                        </button>

                                                        {/* Delete Button */}
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (window.confirm(locale === 'zh' ? '确定要删除这条记录吗？' : 'Delete this conversation?')) {
                                                                    onDeleteScenario(scenario.id);
                                                                }
                                                            }}
                                                            className="p-1 hover:bg-red-50 rounded transition-colors"
                                                            title={locale === 'zh' ? '删除' : 'Delete'}
                                                        >
                                                            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            <p className="text-sm text-gray-500 line-clamp-2 mb-2">
                                                {scenario.userQuery || (locale === 'zh' ? '暂无内容' : 'No content')}
                                            </p>
                                            <div className="flex items-center justify-between text-xs text-gray-400">
                                                <span>{scenario.totalSteps} {locale === 'zh' ? '步' : 'steps'}</span>
                                                {!isBatchMode && scenario.id === activeScenarioId && (
                                                    <span className="text-blue-500 font-medium">
                                                        {locale === 'zh' ? '当前' : 'Active'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Clear History Confirmation Dialog */}
            <ConfirmDialog
                isOpen={isClearHistoryDialogOpen}
                onClose={() => !isDeleting && setIsClearHistoryDialogOpen(false)}
                onConfirm={async () => {
                    setIsDeleting(true);
                    try {
                        await onClearAllHistory();
                        setIsClearHistoryDialogOpen(false);
                        handleClose();
                    } catch (error: any) {
                        alert(error.message || '清空失败');
                    } finally {
                        setIsDeleting(false);
                    }
                }}
                title={locale === 'zh' ? '清空历史记录' : 'Clear All History'}
                message={locale === 'zh'
                    ? '此操作将永久删除所有历史会话记录，包括：\n\n• 所有对话内容\n• 所有水印数据\n• 所有评估结果\n\n此操作不可撤销，是否确认清空？'
                    : 'This action will permanently delete all conversation history, including:\n\n• All conversation content\n• All watermark data\n• All evaluation results\n\nThis action cannot be undone. Are you sure you want to clear all history?'}
                confirmText={isDeleting ? (locale === 'zh' ? '删除中...' : 'Deleting...') : (locale === 'zh' ? '确认清空' : 'Clear All')}
                cancelText={locale === 'zh' ? '取消' : 'Cancel'}
                isDestructive={true}
            />

            {/* Batch Delete Confirmation Dialog */}
            <ConfirmDialog
                isOpen={isBatchDeleteDialogOpen}
                onClose={() => !isDeleting && setIsBatchDeleteDialogOpen(false)}
                onConfirm={async () => {
                    setIsDeleting(true);
                    setIsBatchDeleteDialogOpen(false);
                    try {
                        await onBatchDeleteScenarios(Array.from(selectedScenarios));
                        setSelectedScenarios(new Set());
                        setIsBatchMode(false);
                    } catch (error) {
                        alert(locale === 'zh' ? '批量删除失败' : 'Batch delete failed');
                    } finally {
                        setIsDeleting(false);
                    }
                }}
                title={locale === 'zh' ? '批量删除' : 'Batch Delete'}
                message={locale === 'zh'
                    ? `确定要删除选中的 ${selectedScenarios.size} 条记录吗？\n\n此操作不可撤销。`
                    : `Are you sure you want to delete ${selectedScenarios.size} selected conversation(s)?\n\nThis action cannot be undone.`}
                confirmText={isDeleting ? (locale === 'zh' ? '删除中...' : 'Deleting...') : (locale === 'zh' ? '确认删除' : 'Delete')}
                cancelText={locale === 'zh' ? '取消' : 'Cancel'}
                isDestructive={true}
            />
        </>
    );
}
