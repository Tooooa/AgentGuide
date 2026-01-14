import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, PlusCircle } from 'lucide-react';
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
import FlowFeed from '../execution/FlowFeed';
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
    const [historyScenarios, setHistoryScenarios] = useState<Trajectory[]>([]);
    const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
    const [isSending, setIsSending] = useState(false);
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
        try {
            const sid = sessionId || await startSession();
            const res = await api.addAgentTurn(sid, content, apiKey);
            if (res.step) {
                setSteps((prev) => [...prev, res.step as Step]);
            }
            const promptTrace = res.promptTrace;
            if (promptTrace) {
                const promptText =
                    promptTrace.scoring_prompt_text ||
                    promptTrace.execution_prompt_text ||
                    '';
                setPromptTraceText(promptText);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsSending(false);
        }
    }, [apiKey, isSending, sessionId, startSession]);

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
        setSelectedHistoryId(null);
    };

    const leftPanel = (
        <div className="flex flex-col gap-6 h-full text-slate-800">
            <button
                onClick={handleNewChat}
                className="w-full py-3 px-4 bg-white hover:bg-slate-50 border border-slate-200 hover:border-indigo-300 text-slate-700 rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 font-medium tracking-wide group"
            >
                <PlusCircle size={18} className="text-indigo-500 group-hover:text-indigo-600" />
                {locale === 'zh' ? '新对话' : 'New Chat'}
            </button>

            <div className="h-60 bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden flex flex-col shrink-0">
                <div className="p-3 border-b border-slate-50 bg-slate-50/50 flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        {locale === 'zh' ? '历史记录' : 'History'}
                    </h3>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin scrollbar-thumb-slate-200">
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
                                            ? 'bg-gradient-to-r from-indigo-50 to-blue-50 text-indigo-700 font-medium border-l-3 border-indigo-500 shadow-sm'
                                            : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900'
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="line-clamp-1 leading-relaxed flex-1">
                                            {locale === 'zh' ? (s.title.zh || s.title.en) : s.title.en}
                                        </div>
                                        {isActive && (
                                            <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse shadow-lg shadow-indigo-500/50"></div>
                                        )}
                                    </div>
                                    <div className="mt-1 flex items-center gap-2 text-[10px]">
                                        <span className={isActive ? 'text-indigo-600' : 'text-slate-400'}>
                                            {s.steps.length} turns
                                        </span>
                                        {timeStr && (
                                            <>
                                                <span className={isActive ? 'text-indigo-400' : 'text-slate-400'}>•</span>
                                                <span className={isActive ? 'text-indigo-600' : 'text-slate-400'}>
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
                <div className="p-2 border-t border-slate-50">
                    <button
                        className="w-full text-[10px] text-slate-500 hover:text-indigo-600 font-medium flex items-center justify-center gap-1 transition-colors"
                        onClick={() => undefined}
                    >
                        {locale === 'zh' ? '查看全部历史' : 'View all history'} <span>→</span>
                    </button>
                </div>
            </div>

            <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex flex-col min-h-0">
                <div className="flex items-center gap-2 text-indigo-900 border-b border-indigo-50 pb-2 mb-3 shrink-0">
                    <Activity size={16} />
                    <h3 className="font-bold text-xs uppercase tracking-wide">Utility Monitor</h3>
                </div>

                <div className="flex-1 flex flex-col gap-2 min-h-0 overflow-y-auto pr-1">
                    <div className="flex-1 min-h-[100px] flex flex-col">
                        <div className="flex justify-between items-center mb-1 shrink-0">
                            <span className="text-[10px] font-semibold text-slate-500">Token Throughput</span>
                            <div className="flex gap-2 text-[8px]">
                                <span className="flex items-center gap-0.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span> Ours
                                </span>
                                <span className="flex items-center gap-0.5 text-slate-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span> Base
                                </span>
                            </div>
                        </div>
                        <div className="flex-1 w-full min-h-0 overflow-hidden relative">
                            <ResponsiveContainer width="99%" height="100%" debounce={50}>
                                <LineChart data={chartData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
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
                                        stroke="#cbd5e1"
                                        strokeWidth={2}
                                        strokeDasharray="4 4"
                                        dot={false}
                                        isAnimationActive={false}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="tokens"
                                        stroke="#6366f1"
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
                            <span className="text-[10px] font-semibold text-slate-500">Step Latency (s)</span>
                            <div className="flex gap-2 text-[8px]">
                                <span className="flex items-center gap-0.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span> Ours
                                </span>
                                <span className="flex items-center gap-0.5 text-slate-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span> Base
                                </span>
                            </div>
                        </div>
                        <div className="flex-1 w-full min-h-0 overflow-hidden relative">
                            <ResponsiveContainer width="99%" height="100%" debounce={50}>
                                <LineChart data={chartData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
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
                                        stroke="#cbd5e1"
                                        strokeWidth={2}
                                        strokeDasharray="4 4"
                                        dot={false}
                                        isAnimationActive={false}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="latency"
                                        stroke="#f43f5e"
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
        <MainLayout
            left={leftPanel}
            middle={
                <FlowFeed
                    visibleSteps={steps}
                    erasedIndices={erasedIndices}
                    userQuery={promptTraceText}
                    userQueryLabel="LLM Prompt"
                    onContinue={handleContinue}
                    isPlaying={isSending}
                    promptInputRef={promptInputRef}
                />
            }
            right={
                <DecoderPanel
                    visibleSteps={steps}
                    erasedIndices={erasedIndices}
                    targetPayload={payload}
                    erasureRate={erasureRate}
                    setErasureRate={setErasureRate}
                    promptInputRef={promptInputRef}
                />
            }
            onHome={onHome}
        />
    );
};

export default AddAgentDashboard;
