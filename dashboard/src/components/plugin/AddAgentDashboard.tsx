import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Award, Columns, PlusCircle, Save, Search } from 'lucide-react';
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

const PROMPT_INSTRUCTION = `You are an action-selection assistant.
Return ONLY JSON with your probability over all candidate actions.
Example:
{
  "action_weights": {"Action1": 0.5, "Action2": 0.3, "Action3": 0.2},
  "action_args": {"Action1": {"arg": "value"}, "Action2": {"arg": "value"}, "Action3": {"arg": "value"}},
  "thought": "your thought here"
}
Requirements:
- action_weights MUST include every candidate (or top-K if instructed).
- All action_weights MUST be > 0. Use small values like 1e-3 for unlikely actions.
- action_args should include the chosen action. Other candidates may be omitted or left as empty objects.
  If you include other candidates, keep arguments minimal and consistent with the tool schema.
- Sum does not need to be exact; we will normalize.
- All action_weights must be > 0; do NOT return all zeros.
- Avoid uniform weights; if uncertain, break ties with slight preferences by candidate order.
- If a tool named "agentmark_score_actions" is available, call it with the JSON instead of writing text.
- Do NOT output any extra text or code fences.
- Provide a concise rationale in the thought field (no extra sections).`;

const buildGatewayPromptText = (traceText: string) => {
    if (!traceText) return '';
    try {
        const parsed = JSON.parse(traceText);
        if (Array.isArray(parsed)) {
            const filtered = parsed.filter((msg) => {
                const content = typeof msg?.content === 'string' ? msg.content : '';
                return content && !content.includes(PROMPT_INSTRUCTION);
            });
            if (filtered.length > 0) {
                return filtered
                    .map((msg) => `${msg.role}: ${msg.content}`)
                    .join('\n');
            }
        }
    } catch (err) {
        // ignore parse errors and fall back to text processing
    }
    return traceText.replace(PROMPT_INSTRUCTION, '').trim();
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

    const gatewayPromptText = useMemo(() => {
        if (!promptTraceText) return '';
        return buildGatewayPromptText(promptTraceText);
    }, [promptTraceText]);

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
                // Filter for add_agent scenarios
                const saved = await api.listScenarios('add_agent');
                setHistoryScenarios(saved);
            } catch (e) {
                console.error('Failed to load scenarios', e);
            }
        };
        loadScenarios();
    }, []);

    const handleSave = async () => {
        if (!sessionId || steps.length === 0) return;

        try {
            // Construct saving data
            const scenarioData = {
                id: sessionId,
                title: { en: "Add Agent Session", zh: "插件会话" }, // Default title
                taskName: "Add Agent Task",
                userQuery: steps[0]?.thought || "New Conversation",
                promptTrace: promptTraceText,
                baselinePromptTrace: baselinePromptTraceText,
                evaluation: evaluationResult || undefined,
                totalSteps: steps.length,
                steps: steps,
                type: 'add_agent'
            };

            // Generate better title if possible
            const firstMessage = steps[0]?.thought || "";
            const titlePreview = firstMessage.length > 30 ? firstMessage.substring(0, 30) + '...' : firstMessage;
            if (titlePreview) {
                scenarioData.title = { en: titlePreview, zh: titlePreview };
            }

            await api.saveScenario(scenarioData.title, scenarioData, sessionId, 'add_agent');

            // Refresh history
            const saved = await api.listScenarios('add_agent');
            setHistoryScenarios(saved);
            alert('Session saved!');
        } catch (e) {
            console.error("Failed to save session", e);
            alert("Failed to save session");
        }
    };

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

    const handleHistorySelect = (s: Trajectory) => {
        setSelectedHistoryId(s.id);
        setSessionId(s.id);
        const stepsWithBaseline = s.steps || [];
        setSteps(stepsWithBaseline);

        // Restore user query if available
        if (s.userQuery) {
            setPromptUserInput(s.userQuery);
        }

        setPromptTraceText(s.promptTrace || '');
        setBaselinePromptTraceText(s.baselinePromptTrace || '');

        // Auto-switch to comparison mode if baseline data exists
        const hasBaseline = stepsWithBaseline.some(step => step.baseline);
        setIsComparisonMode(hasBaseline);

        // Restore evaluation if available
        if (s.evaluation) {
            setEvaluationResult(s.evaluation);
        } else {
            setEvaluationResult(null);
        }

        // Reset modal state
        setIsEvaluationModalOpen(false);
    };
    const leftPanel = (
        <div className="flex flex-col gap-6 h-full text-slate-900">
            <div className="rounded-2xl bg-white/85 border border-indigo-100/80 shadow-sm p-1 flex items-center gap-1">
                <button
                    onClick={() => setIsComparisonMode(false)}
                    className={`flex-1 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all ${!isComparisonMode
                        ? 'bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 text-white shadow shadow-blue-200/60'
                        : 'text-slate-500 hover:bg-sky-50'
                        }`}
                >
                    {locale === 'zh' ? '标准' : 'Standard'}
                </button>
                <button
                    onClick={() => setIsComparisonMode(true)}
                    className={`flex-1 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 ${isComparisonMode
                        ? 'bg-gradient-to-r from-teal-500 via-emerald-500 to-cyan-600 text-white shadow shadow-teal-200/60'
                        : 'text-slate-500 hover:bg-teal-50'
                        }`}
                >
                    <Columns size={12} />
                    {locale === 'zh' ? '对比' : 'Compare'}
                </button>
            </div>

            {!isComparisonMode && (
                <>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleNewChat}
                            className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-200"
                        >
                            <PlusCircle size={14} />
                            {locale === 'zh' ? '新对话' : 'New Chat'}
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={!sessionId || steps.length === 0}
                            className={`px-4 py-2.5 rounded-xl border border-indigo-200 text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${!sessionId || steps.length === 0
                                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                : 'bg-white hover:bg-indigo-50 text-indigo-700 shadow-sm'
                                }`}
                        >
                            <Save size={14} />
                            {locale === 'zh' ? '保存' : 'Save'}
                        </button>
                    </div>

                    {/* History List */}
                    <div className="flex-1 bg-white/80 backdrop-blur-sm rounded-2xl border border-white/50 shadow-sm flex flex-col overflow-hidden">
                        <div className="p-4 border-b border-indigo-50/50 flex justify-between items-center">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                                {locale === 'zh' ? '插件历史' : 'Plugin History'}
                            </h3>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-indigo-100/50 hover:scrollbar-thumb-indigo-200/50">
                            {historyScenarios.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2 opacity-60">
                                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                                        <Search size={20} className="text-slate-300" />
                                    </div>
                                    <span className="text-xs">
                                        {locale === 'zh' ? '暂无记录' : 'No history yet'}
                                    </span>
                                </div>
                            ) : (
                                historyScenarios.map((s) => (
                                    <div
                                        key={s.id}
                                        onClick={() => handleHistorySelect(s)}
                                        className={`p-3 rounded-xl mb-2 cursor-pointer transition-all border ${selectedHistoryId === s.id
                                            ? 'bg-gradient-to-r from-indigo-50 to-blue-50 border-indigo-200 shadow-sm'
                                            : 'hover:bg-white border-transparent hover:border-indigo-50 hover:shadow-sm'
                                            }`}
                                    >
                                        <div className="text-xs font-bold text-slate-700 line-clamp-1 mb-1">
                                            {locale === 'zh' ? (s.title.zh || s.title.en) : s.title.en}
                                        </div>
                                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                                            <span>{s.steps.length} turns</span>
                                            <span>{new Date(s.createdAt || Date.now()).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </>
            )}
            {
                isComparisonMode && (
                    <>
                        <button
                            onClick={handleEvaluate}
                            disabled={isEvaluating}
                            className={`w-full py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm ${isEvaluating
                                ? 'bg-teal-50 text-teal-500 cursor-wait'
                                : 'bg-gradient-to-r from-teal-400 via-emerald-500 to-cyan-500 text-white shadow-teal-200/60 hover:shadow-emerald-200/60'
                                }`}
                        >
                            {isEvaluating ? (
                                <>
                                    <div className="w-3 h-3 border-2 border-teal-200 border-t-teal-500 rounded-full animate-spin"></div>
                                    {locale === 'zh' ? '评估中...' : 'Evaluating...'}
                                </>
                            ) : (
                                <>
                                    <Award size={14} className="text-teal-100" />
                                    {locale === 'zh' ? '评估智能体' : 'Evaluate Agents'}
                                </>
                            )}
                        </button>
                        {evaluationResult && (
                            <div className="bg-white/90 rounded-xl border border-teal-100/80 p-3 shadow-sm flex items-center justify-between">
                                <div className="flex flex-col items-center flex-1 border-r border-teal-100/60">
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
                )
            }



            <div className="flex-1 bg-white/80 rounded-2xl shadow-[0_20px_45px_-30px_rgba(15,23,42,0.4)] border border-teal-100/70 ring-1 ring-teal-100/60 p-5 flex flex-col min-h-0">
                <div className="flex items-center gap-2 text-teal-800 border-b border-teal-100/70 pb-2 mb-3 shrink-0">
                    <Activity size={16} className="text-teal-500" />
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
                                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-500"></span> Ours
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
        </div >
    );

    return (
        <div className="relative h-screen overflow-hidden bg-slate-50">
            {/* Ambient Background - Blue/Indigo Theme for Standard Mode */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full bg-indigo-200/30 blur-3xl opacity-60 mix-blend-multiply" />
                <div className="absolute bottom-[-10%] left-[-5%] w-[600px] h-[600px] rounded-full bg-blue-100/40 blur-3xl opacity-60 mix-blend-multiply" />
                <div className="absolute top-[20%] left-[10%] w-[400px] h-[400px] rounded-full bg-sky-100/30 blur-3xl opacity-40 mix-blend-multiply" />
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
                            userQuery={gatewayPromptText || promptUserInput}
                            promptInstruction={PROMPT_INSTRUCTION}
                            evaluationResult={evaluationResult}
                            variant="add_agent"
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
                            variant="add_agent"
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
                            variant="add_agent"
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
                variant="add_agent"
            />
        </div>
    );
};

export default AddAgentDashboard;
