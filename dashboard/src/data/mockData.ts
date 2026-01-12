
import data4117 from './4117.json';
import data9581 from './9581.json';
// import data4155 from './4155.json'; // Replaced with better examples
import data3672 from './3672.json';
import data5965 from './5965.json';
import data83 from './83.json';

// --- Types ---

export type DistributionItem = {
    name: string;
    prob: number;
    isSelected: boolean;
};

export type StepWatermark = {
    bits: string;
    matrixRows: number[][]; // Changed to support multiple rows per step
    rankContribution: number;
};

export type Step = {
    stepIndex: number;
    thought: string;
    action: string;
    toolDetails?: string;
    distribution: DistributionItem[];
    watermark: StepWatermark;
    stepType: 'tool' | 'finish' | 'user_input' | 'other';
    metrics?: {
        latency: number;
        tokens: number;
    };
    finalAnswer?: string;
    isHidden?: boolean;
    // New field for Comparison Mode (Dual Agent)
    baseline?: {
        thought: string;
        action: string;
        toolDetails?: string;
        distribution: DistributionItem[];
        stepType: 'tool' | 'finish' | 'user_input' | 'other';
        finalAnswer?: string;
        metrics?: {
            latency: number;
            tokens: number;
        };
        isHidden?: boolean;
    };
};

export type Trajectory = {
    id: string;
    title: {
        en: string;
        zh: string;
    };
    taskName: string; // Legacy support or internal ID
    userQuery: string;
    totalSteps: number;
    steps: Step[];
    evaluation?: { model_a_score: number, model_b_score: number, reason: string };
};

// --- Helper Functions ---

const generateRandomMatrixRow = (seed: number, length: number = 16): number[] => {
    const row = [];
    for (let i = 0; i < length; i++) {
        // Simple deterministic random based on seed
        const x = Math.sin(seed + i) * 10000;
        row.push((x - Math.floor(x)) > 0.5 ? 1 : 0);
    }
    return row;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseToolBenchData = (jsonData: any, manualId: string, titleEn: string, titleZh: string): Trajectory => {
    const steps: Step[] = [];
    const details = jsonData.answer_details || [];
    const traces = jsonData.watermark_trace || [];

    const finalId = manualId || jsonData.id?.toString() || "unknown";

    // Map traces to steps
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    traces.forEach((trace: any, index: number) => {
        const rawProbs = trace.raw_probs || {};
        const chosen = trace.chosen;

        const distribution: DistributionItem[] = Object.entries(rawProbs).map(([name, prob]) => ({
            name,
            prob: prob as number,
            isSelected: name === chosen
        })).sort((a, b) => b.prob - a.prob);

        const stepIndex = index;

        // Find relevant detail
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const relevantDetail = details.filter((d: any) => d.role === 'assistant')[index];
        let thought = "Thinking...";
        let toolOutput = undefined;

        if (relevantDetail) {
            if (relevantDetail.message) {
                const msg = relevantDetail.message;
                const thoughtMatch = msg.match(/Thought:\s*(.*?)(?=\n|{|$)/s);
                if (thoughtMatch) thought = thoughtMatch[1].trim();
            }

            // Find valid tool output following this action
            const detailIndex = details.indexOf(relevantDetail);
            if (detailIndex !== -1 && detailIndex + 1 < details.length) {
                const nextMsg = details[detailIndex + 1];
                if (nextMsg.role === 'tool' || nextMsg.role === 'user') { // Sometimes user simulates tool return
                    toolOutput = nextMsg.message;
                }
            }
        }

        // Determine type
        const isFinish = chosen === 'Finish';

        // Extract REAL watermark data if available
        let matrixRows: number[][] = [];
        let bitsStr = "";
        let rankContrib = 0;

        if (trace.bit_index_after !== undefined && trace.bit_index_before !== undefined) {
            const startBit = trace.bit_index_before;
            const endBit = trace.bit_index_after;
            const bitCount = endBit - startBit;
            rankContrib = bitCount;

            // Generate deterministic "real-looking" rows for each bit
            // In a real decoder, we would have the actual coeffs. Here we mock them deterministically based on bit index.
            for (let b = 0; b < bitCount; b++) {
                // Use step index + bit offset to generate distinct rows
                matrixRows.push(generateRandomMatrixRow(index * 100 + b + parseInt(finalId.replace(/\D/g, '') || '0')));
                bitsStr += (Math.random() > 0.5 ? "1" : "0"); // Placeholder bits
            }
        } else {
            // Fallback for mock data (1 row per step)
            matrixRows.push(generateRandomMatrixRow(index * 999));
            bitsStr = "1";
            rankContrib = 1;
        }

        steps.push({
            stepIndex,
            thought,
            action: isFinish ? "Call: Finish" : `Call: ${chosen}`,
            toolDetails: toolOutput,
            distribution,
            watermark: {
                bits: bitsStr,
                matrixRows,
                rankContribution: rankContrib
            },
            stepType: isFinish ? 'finish' : 'tool',
            finalAnswer: isFinish ? (jsonData.final_answer?.final_answer || toolOutput) : undefined,
        });
    });

    return {
        id: finalId,
        title: {
            en: titleEn,
            zh: titleZh
        },
        taskName: titleEn,
        userQuery: jsonData.query,
        totalSteps: steps.length,
        steps
    };
};

// --- Exports ---

export const scenarios: Trajectory[] = [
    parseToolBenchData(data3672, '3672', 'Cinema Ticket', '订电影票'),
    parseToolBenchData(data5965, '5965', 'Travel Planning', '旅行规划'),
    parseToolBenchData(data83, '83', 'Online Shopping', '在线购物'),
    parseToolBenchData(data4117, '4117', 'Unit Conversion', '单位换算'),
    parseToolBenchData(data9581, '9581', 'Tv Schedule', '电视节目表'),
];
