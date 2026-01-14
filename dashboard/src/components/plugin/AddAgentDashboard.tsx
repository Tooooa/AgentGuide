import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
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
import type { Step } from '../../data/mockData';
import { api } from '../../services/api';

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
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [steps, setSteps] = useState<Step[]>([]);
    const [promptTraceText, setPromptTraceText] = useState('');
    const [lastWatermark, setLastWatermark] = useState<any | null>(null);
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
            if (res.watermark) {
                setLastWatermark(res.watermark);
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

    const candidateList = lastWatermark?.candidates_used || [];
    const candidateMode = lastWatermark?.mode || '-';

    const leftPanel = (
        <div className="flex flex-col gap-6 h-full text-slate-800">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
                <div className="text-sm font-semibold text-slate-500 uppercase tracking-widest">Add Agent</div>
                <div className="text-sm text-slate-700">
                    <div className="font-semibold">Repository</div>
                    <div className="text-xs text-slate-500 break-all mt-1">{repoUrl || '-'}</div>
                </div>
                <div className="text-sm text-slate-700">
                    <div className="font-semibold">API Key</div>
                    <div className="text-xs text-slate-500 mt-1">{apiKey ? '••••••••' : '-'}</div>
                </div>
                <div className="text-sm text-slate-700">
                    <div className="font-semibold">Candidate Source</div>
                    <div className="text-xs text-slate-500 mt-1">{candidateMode}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {candidateList.length > 0 ? (
                            candidateList.map((name: string) => (
                                <span
                                    key={name}
                                    className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
                                >
                                    {name}
                                </span>
                            ))
                        ) : (
                            <span className="text-xs text-slate-400">-</span>
                        )}
                    </div>
                </div>
                <div className="text-xs text-slate-500">
                    建议输入：例如“北京的天气怎么样？”
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
