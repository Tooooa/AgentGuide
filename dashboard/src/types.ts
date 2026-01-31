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
    timestamp?: string;
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
    promptTrace?: string;
    baselinePromptTrace?: string;
    userQueryZh?: string; // Added for localization
    totalSteps: number;
    steps: Step[];
    evaluation?: { model_a_score: number, model_b_score: number, reason: string };
    createdAt?: string;
    updatedAt?: string;
    payload?: string; // Added for payload persistence
};
