import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Award, Columns, PlusCircle } from 'lucide-react';
import {
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis
} from 'recharts';
import MainLayout from '../layout/MainLayout';
import ComparisonView from '../layout/ComparisonView';
import FlowFeed from '../execution/FlowFeed';
import EvaluationModal from '../execution/EvaluationModal';
import DecoderPanel from '../decoder/DecoderPanel';
import type { Step, Trajectory } from '../../data/mockData';
import { api } from '../../services/api';
import { useI18n } from '../../i18n/I18nContext';

type AddAgentDashboardProps = {
    onHome: () => void;
    apiKey: string;
    repoUrl: string;
    payload: string;
    erasureRate: number;
    setErasureRate: (val: number) => void;
    initialInput?: string;
};

const AddAgentDashboard: React.FC<AddAgentDashboardProps> = ({
    onHome,
    apiKey,
    repoUrl,
    payload,
    erasureRate,
    setErasureRate,
    initialInput
}) => {
    const { locale } = useI18n();
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [steps, setSteps] = useState<Step[]>([]);
    const [promptTraceText, setPromptTraceText] = useState('');
    const [baselinePromptTraceText, setBaselinePromptTraceText] = useState('');
    const [promptUserInput, setPromptUserInput] = useState('');
    const [historyScenarios, setHistoryScenarios] = useState<Trajectory[]>([]);
    const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
    const [isSending, setIsSending] = useState(false);
    const [isComparisonMode, setIsComparisonMode] = useState(false);
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [evaluationResult, setEvaluationResult] = useState<{
        model_a_score: number;
        model_b_score: number;
        reason: string;
    } | null>(null);
    const [isEvaluationModalOpen, setIsEvaluationModalOpen] = useState(false);
    const erasedIndices = useMemo(() => new Set<number>(), []);
    const promptInputRef = useRef<HTMLInputElement>(null);
    const chartData = useMemo(() => {
        const data = steps.map((step) => ({
            step: step.stepIndex,
            tokens: step.metrics?.tokens ?? null,
            latency: step.metrics?.latency ?? null,
            baseTokens: step.baseline?.metrics?.tokens ?? null,
            baseLatency: step.baseline?.metrics?.latency ?? null
        }));
        if (data.length === 0) {
            data.push({
                step: 0,
                tokens: null,
                latency: null,
                baseTokens: null,
                baseLatency: null
            });
        }
        return data;
    }, [steps]);

    const formatPromptTrace = useCallback((trace: any) => {
        if (!trace) return '';
        const messages = trace.scoring_messages || trace.execution_messages;
        if (Array.isArray(messages) && messages.length > 0) {
            try {
                return JSON.stringify(messages, null, 2);
            } catch (err) {
                console.error('Failed to format prompt trace', err);
            }
        }
        return trace.scoring_prompt_text || trace.execution_prompt_text || '';
    }, []);

    const startSession = useCallback(async () => {
        const res = await api.addAgentStart(apiKey, repoUrl);
        setSessionId(res.sessionId);
        return res.sessionId;
    }, [apiKey, repoUrl]);

    const handleContinue = useCallback(async (prompt: string) => {
        if (isSending) return;
        const content = prompt.trim();
        if (!content) return;
        setIsSending(true);
        setPromptUserInput(content);
        if (evaluationResult) {
            setEvaluationResult(null);
            setIsEvaluationModalOpen(false);
        }
        if (baselinePromptTraceText) {
            setBaselinePromptTraceText('');
        }
        try {
            let sid = sessionId || await startSession();
            let res;
            try {
                res = await api.addAgentTurn(sid, content, apiKey);
            } catch (err: any) {
                const status = err?.response?.status;
                if (status === 404) {
                    setSessionId(null);
                    setSteps([]);
                    setPromptTraceText('');
                    setBaselinePromptTraceText('');
                    setSelectedHistoryId(null);
                    setEvaluationResult(null);
                    setIsEvaluationModalOpen(false);
                    sid = await startSession();
                    res = await api.addAgentTurn(sid, content, apiKey);
                } else {
                    throw err;
                }
            }
            if (res.step) {
                setSteps((prev) => [...prev, res.step as Step]);
            }
            const promptTrace = res.promptTrace;
            if (promptTrace) {
                setPromptTraceText(formatPromptTrace(promptTrace));
            }
            const baseTrace = res.baselinePromptTrace;
            if (baseTrace) {
                setBaselinePromptTraceText(formatPromptTrace(baseTrace));
            } else {
                setBaselinePromptTraceText('');
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsSending(false);
        }
    }, [apiKey, isSending, sessionId, startSession, formatPromptTrace, evaluationResult, baselinePromptTraceText]);

    useEffect(() => {
        if (initialInput) {
            handleContinue(initialInput);
        }
    }, [initialInput, handleContinue]);

    useEffect(() => {
        const loadScenarios = async () => {
            try {
                const saved = await api.listScenarios();
                setHistoryScenarios(saved);
            } catch (e) {
                console.error('Failed to load scenarios', e);
            }
        };
        loadScenarios();
    }, []);

    const handleNewChat = () => {
        setSessionId(null);
        setSteps([]);
        setPromptTraceText('');
        setBaselinePromptTraceText('');
        setPromptUserInput('');
        setSelectedHistoryId(null);
        setEvaluationResult(null);
        setIsEvaluationModalOpen(false);
    };

    const handleEvaluate = useCallback(async () => {
        if (!sessionId || steps.length === 0) {
            alert(locale === 'zh' ? '没有可评估的对话' : 'No conversation to evaluate');
            return;
        }
        if (evaluationResult) {
            setIsEvaluationModalOpen(true);
            return;
        }
        setIsEvaluating(true);
        setIsEvaluationModalOpen(true);
        try {
            const result = await api.addAgentEvaluate(sessionId, locale);
            setEvaluationResult(result);
        } catch (e: any) {
            console.error('Add agent evaluation failed', e);
            const errorMsg = e.response?.data?.detail || e.message || 'Unknown error';
            alert(
                (locale === 'zh'
                    ? `评估失败: ${errorMsg}`
                    : `Evaluation failed: ${errorMsg}`) +
                    '\n\n' +
                    (locale === 'zh'
                        ? '请确认后端运行正常且已有对话步骤。'
                        : 'Please ensure the backend is running and there are steps to evaluate.')
            );
            setIsEvaluationModalOpen(false);
        } finally {
            setIsEvaluating(false);
        }
    }, [sessionId, steps.length, evaluationResult, locale]);

    const leftPanel = (
        <div className="flex flex-col gap-6 h-full text-slate-900">
            <div className="rounded-2xl bg-white/85 border border-indigo-100/80 shadow-sm p-1 flex items-center gap-1">
                <button
                    onClick={() => setIsComparisonMode(false)}
                    className={`flex-1 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all ${
                        !isComparisonMode
                            ? 'bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 text-white shadow shadow-blue-200/60'
                            : 'text-slate-500 hover:bg-sky-50'
                    }`}
                >
                    {locale === 'zh' ? '标准' : 'Standard'}
                </button>
                <button
                    onClick={() => setIsComparisonMode(true)}
                    className={`flex-1 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                        isComparisonMode
                            ? 'bg-gradient-to-r from-cyan-500 via-sky-500 to-indigo-500 text-white shadow shadow-cyan-200/60'
                            : 'text-slate-500 hover:bg-cyan-50'
                    }`}
                >
                    <Columns size={12} />
                    {locale === 'zh' ? '对比' : 'Compare'}
                </button>
            </div>
            {isComparisonMode && (
                <>
                    <button
                        onClick={handleEvaluate}
                        disabled={isEvaluating}
                        className={`w-full py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm ${
                            isEvaluating
                                ? 'bg-amber-50 text-amber-500 cursor-wait'
                                : 'bg-gradient-to-r from-yellow-400 via-amber-500 to-yellow-500 text-white shadow-yellow-200/60 hover:shadow-amber-200/60'
                        }`}
                    >
                        {isEvaluating ? (
                            <>
                                <div className="w-3 h-3 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
                                {locale === 'zh' ? '评估中...' : 'Evaluating...'}
                            </>
                        ) : (
                            <>
                                <Award size={14} className="text-amber-100" />
                                {locale === 'zh' ? '评估智能体' : 'Evaluate Agents'}
                            </>
                        )}
                    </button>
                    {evaluationResult && (
                        <div className="bg-white/90 rounded-xl border border-amber-100/80 p-3 shadow-sm flex items-center justify-between">
                            <div className="flex flex-col items-center flex-1 border-r border-amber-100/60">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                    {locale === 'zh' ? '基础' : 'Base'}
                                </span>
                                <div className="flex items-center text-sm font-bold text-slate-700">
                                    {Number(evaluationResult.model_a_score).toFixed(1)}
                                    <span className="text-[10px] text-slate-400 ml-0.5">/10</span>
                                </div>
                            </div>
                            <div className="flex flex-col items-center flex-1">
                                <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">
                                    {locale === 'zh' ? '水印' : 'Ours'}
                                </span>
                                <div className="flex items-center text-sm font-bold text-emerald-600">
                                    {Number(evaluationResult.model_b_score).toFixed(1)}
                                    <span className="text-[10px] text-emerald-300 ml-0.5">/10</span>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
            <button
                onClick={handleNewChat}
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-yellow-400 via-amber-500 to-yellow-500 text-white font-semibold shadow-lg shadow-yellow-500/30 hover:shadow-amber-500/40 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 tracking-wide group"
            >
                <PlusCircle size={18} className="text-white/90 group-hover:text-white" />
                {locale === 'zh' ? '新对话' : 'New Chat'}
            </button>

            <div className="h-60 bg-white/80 rounded-2xl shadow-[0_25px_60px_-35px_rgba(15,23,42,0.45)] border border-amber-100/70 ring-1 ring-amber-100/60 overflow-hidden flex flex-col shrink-0">
                <div className="p-3 border-b border-amber-100/70 bg-amber-50/60 flex items-center justify-between">
                    <h3 className="text-xs font-bold text-amber-600 uppercase tracking-wider">
                        {locale === 'zh' ? '历史记录' : 'History'}
                    </h3>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin scrollbar-thumb-amber-200">
                    {historyScenarios.length === 0 ? (
                        <div className="text-center text-slate-400 text-xs py-8">
                            {locale === 'zh' ? '暂无历史记录' : 'No history yet'}
                        </div>
                    ) : (
                        historyScenarios.map((s) => {
                            const timestampMatch = s.id.match(/sess_(\d+)_/);
                            let timeStr = '';
                            if (timestampMatch) {
                                const timestamp = parseInt(timestampMatch[1]) * 1000;
                                const date = new Date(timestamp);
                                const now = new Date();
                                const diffMs = now.getTime() - date.getTime();
                                const diffMins = Math.floor(diffMs / 60000);
                                const diffHours = Math.floor(diffMs / 3600000);
                                const diffDays = Math.floor(diffMs / 86400000);

                                if (diffMins < 1) {
                                    timeStr = locale === 'zh' ? '刚刚' : 'Just now';
                                } else if (diffMins < 60) {
                                    timeStr = locale === 'zh' ? `${diffMins}分钟前` : `${diffMins}m ago`;
                                } else if (diffHours < 24) {
                                    timeStr = locale === 'zh' ? `${diffHours}小时前` : `${diffHours}h ago`;
                                } else if (diffDays < 7) {
                                    timeStr = locale === 'zh' ? `${diffDays}天前` : `${diffDays}d ago`;
                                } else {
                                    timeStr = date.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {
                                        month: 'short',
                                        day: 'numeric'
                                    });
                                }
                            }

                            const isActive = selectedHistoryId === s.id;

                            return (
                                <div
                                    key={s.id}
                                    onClick={() => setSelectedHistoryId(s.id)}
                                    className={`w-full text-left p-3 rounded-lg text-sm transition-all group relative cursor-pointer ${
                                        isActive
                                            ? 'bg-gradient-to-r from-amber-50 via-white to-emerald-50 text-amber-800 font-semibold border-l-4 border-amber-400 shadow-sm'
                                            : 'hover:bg-amber-50/60 text-slate-700 hover:text-slate-900'
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="line-clamp-1 leading-relaxed flex-1">
                                            {locale === 'zh' ? (s.title.zh || s.title.en) : s.title.en}
                                        </div>
                                        {isActive && (
                                            <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse shadow-lg shadow-amber-400/40"></div>
                                        )}
                                    </div>
                                    <div className="mt-1 flex items-center gap-2 text-[10px]">
                                        <span className={isActive ? 'text-amber-700' : 'text-slate-400'}>
                                            {s.steps.length} turns
                                        </span>
                                        {timeStr && (
                                            <>
                                                <span className={isActive ? 'text-amber-500' : 'text-slate-400'}>•</span>
                                                <span className={isActive ? 'text-amber-700' : 'text-slate-400'}>
                                                    {timeStr}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
                <div className="p-2 border-t border-amber-100/70">
                    <button
                        className="w-full text-[10px] text-slate-500 hover:text-amber-700 font-medium flex items-center justify-center gap-1 transition-colors"
                        onClick={() => undefined}
                    >
                        {locale === 'zh' ? '查看全部历史' : 'View all history'} <span>→</span>
                    </button>
                </div>
            </div>

            <div className="flex-1 bg-white/80 rounded-2xl shadow-[0_20px_45px_-30px_rgba(15,23,42,0.4)] border border-amber-100/70 ring-1 ring-amber-100/60 p-5 flex flex-col min-h-0">
                <div className="flex items-center gap-2 text-amber-800 border-b border-amber-100/70 pb-2 mb-3 shrink-0">
                    <Activity size={16} className="text-amber-500" />
                    <h3 className="font-bold text-xs uppercase tracking-wide">Utility Monitor</h3>
                </div>

                <div className="flex-1 flex flex-col gap-2 min-h-0 overflow-y-auto pr-1">
                    <div className="flex-1 min-h-[100px] flex flex-col">
                        <div className="flex justify-between items-center mb-1 shrink-0">
                            <span className="text-[10px] font-semibold text-slate-600">Token Throughput</span>
                            <div className="flex gap-2 text-[8px]">
                                <span className="flex items-center gap-0.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span> Ours
                                </span>
                                <span className="flex items-center gap-0.5 text-slate-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span> Base
                                </span>
                            </div>
                        </div>
                        <div className="flex-1 w-full min-h-0 overflow-hidden relative">
                            <ResponsiveContainer width="99%" height="100%" debounce={50}>
                                <LineChart data={chartData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                                    <XAxis dataKey="step" hide />
                                    <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={20} />
                                    <Tooltip
                                        contentStyle={{ fontSize: '10px' }}
                                        itemStyle={{ padding: 0 }}
                                        wrapperStyle={{ zIndex: 1000 }}
                                        isAnimationActive={false}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="baseTokens"
                                        stroke="#94a3b8"
                                        strokeWidth={2}
                                        strokeDasharray="4 4"
                                        dot={false}
                                        isAnimationActive={false}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="tokens"
                                        stroke="#0f766e"
                                        strokeWidth={2}
                                        dot={{ r: 2 }}
                                        activeDot={{ r: 4 }}
                                        isAnimationActive={false}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <div className="flex-1 min-h-[100px] flex flex-col">
                        <div className="flex justify-between items-center mb-1 shrink-0">
                            <span className="text-[10px] font-semibold text-slate-600">Step Latency (s)</span>
                            <div className="flex gap-2 text-[8px]">
                                <span className="flex items-center gap-0.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span> Ours
                                </span>
                                <span className="flex items-center gap-0.5 text-slate-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span> Base
                                </span>
                            </div>
                        </div>
                        <div className="flex-1 w-full min-h-0 overflow-hidden relative">
                            <ResponsiveContainer width="99%" height="100%" debounce={50}>
                                <LineChart data={chartData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                                    <XAxis dataKey="step" hide />
                                    <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={20} />
                                    <Tooltip
                                        contentStyle={{ fontSize: '10px' }}
                                        itemStyle={{ padding: 0 }}
                                        wrapperStyle={{ zIndex: 1000 }}
                                        isAnimationActive={false}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="baseLatency"
                                        stroke="#94a3b8"
                                        strokeWidth={2}
                                        strokeDasharray="4 4"
                                        dot={false}
                                        isAnimationActive={false}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="latency"
                                        stroke="#f97316"
                                        strokeWidth={2}
                                        dot={{ r: 2 }}
                                        activeDot={{ r: 4 }}
                                        isAnimationActive={false}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="relative h-screen overflow-hidden bg-slate-50">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -top-32 left-1/2 h-[28rem] w-[46rem] -translate-x-1/2 rounded-full bg-gradient-to-tr from-sky-200/55 via-indigo-200/45 to-purple-200/40 blur-[110px]" />
                <div className="absolute top-16 -left-24 h-96 w-96 rounded-full bg-cyan-200/40 blur-[130px]" />
                <div className="absolute -bottom-40 right-0 h-[30rem] w-[30rem] rounded-full bg-blue-200/45 blur-[140px]" />
                <div className="absolute bottom-10 left-1/3 h-72 w-72 rounded-full bg-sky-200/35 blur-[120px]" />
            </div>
            <MainLayout
                variant="add_agent"
                layout={isComparisonMode ? 'compare' : 'standard'}
                left={leftPanel}
                middle={
                    isComparisonMode ? (
                        <ComparisonView
                            visibleSteps={steps}
                            erasedIndices={erasedIndices}
                            scenarioId={sessionId || undefined}
                            userQuery={promptUserInput}
                            evaluationResult={evaluationResult}
                        />
                    ) : (
                        <FlowFeed
                            visibleSteps={steps}
                            erasedIndices={erasedIndices}
                            userQuery={promptTraceText}
                            userQueryLabel="LLM Prompt"
                            userQueryFormat="json"
                            userInputHighlight={promptUserInput}
                            userInputLabel="User Input"
                            onContinue={handleContinue}
                            isPlaying={isSending}
                            promptInputRef={promptInputRef}
                        />
                    )
                }
                right={
                    isComparisonMode ? null : (
                        <DecoderPanel
                            visibleSteps={steps}
                            erasedIndices={erasedIndices}
                            targetPayload={payload}
                            erasureRate={erasureRate}
                            setErasureRate={setErasureRate}
                            promptInputRef={promptInputRef}
                        />
                    )
                }
                onHome={onHome}
            />
            <EvaluationModal
                isOpen={isEvaluationModalOpen}
                onClose={() => setIsEvaluationModalOpen(false)}
                result={evaluationResult}
                isLoading={isEvaluating}
            />
        </div>
    );
};

export default AddAgentDashboard;
