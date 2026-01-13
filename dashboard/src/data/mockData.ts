
// Mock data removed - using database only

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// --- Exports ---

// Default preset scenarios from original ToolBench data
export const scenarios: Trajectory[] = [
    {
        id: 'preset_1301',
        title: {
            en: 'Find Top-Rated Movies',
            zh: '查找高评分电影'
        },
        taskName: 'Movie Search',
        userQuery: 'I want to find movies with high ratings. Can you provide me with a list of top-rated movies along with their IMDb ratings and summaries? Please sort the results by their IMDb ratings in descending order.',
        totalSteps: 0,
        steps: []
    },
    {
        id: 'preset_28',
        title: {
            en: 'Track Package Delivery',
            zh: '追踪包裹配送'
        },
        taskName: 'Package Tracking',
        userQuery: 'I am currently tracking a package with the ID CA107308006SI. Can you provide me with the latest information and localization details of the package? Additionally, I would like to know the country and the type of event associated with the package.',
        totalSteps: 0,
        steps: []
    },
    {
        id: 'preset_4117',
        title: {
            en: 'Unit Conversion',
            zh: '单位换算'
        },
        taskName: 'Unit Converter',
        userQuery: "I'm planning a trip and need to convert 90 degrees to turns. Additionally, I would like to convert 100 grams to pounds and find out the temperature in Celsius for a given Fahrenheit value of 90.",
        totalSteps: 0,
        steps: []
    },
    {
        id: 'preset_3672',
        title: {
            en: 'Movie Night Planning',
            zh: '电影之夜计划'
        },
        taskName: 'Movie & Music',
        userQuery: "I'm planning a movie night with my family, and I need a movie that is suitable for all ages. Can you provide me with the detailed response for the movie with the ID 399566? Additionally, fetch the monthly top 100 music torrents for some lively background music during the movie night.",
        totalSteps: 0,
        steps: []
    },
    {
        id: 'preset_9581',
        title: {
            en: 'Movie Recommendations',
            zh: '电影推荐'
        },
        taskName: 'Similar Movies',
        userQuery: "My company is organizing a movie-themed event and we're looking for movies that are similar to 'Titanic'. Can you recommend some movies with a similar genre and visual style? Additionally, it would be great if you could provide a list of movies along with their posters and release dates.",
        totalSteps: 0,
        steps: []
    },
    {
        id: 'preset_4155',
        title: {
            en: 'Check Order Status',
            zh: '查询订单状态'
        },
        taskName: 'Order Details',
        userQuery: 'Can you fetch the details of my recent orders? I would like to know the products I ordered, the order status, and the delivery date.',
        totalSteps: 0,
        steps: []
    },
    {
        id: 'preset_83',
        title: {
            en: 'Gift Package Tracking',
            zh: '礼物包裹追踪'
        },
        taskName: 'Gift Delivery',
        userQuery: "I want to surprise my family by tracking the delivery of the gift package with the tracking ID 6045e2f44e1b233199a5e77a. Can you provide me with the current status? Also, fetch the relevant information for the Pack & Send reference number 'ReferenceNumberHere'. Additionally, check the health of the suivi-colis API.",
        totalSteps: 0,
        steps: []
    },
    {
        id: 'preset_29',
        title: {
            en: 'Monitor Multiple Packages',
            zh: '监控多个包裹'
        },
        taskName: 'Batch Tracking',
        userQuery: 'My company needs to monitor the progress of multiple packages. Can you help us count the number of steps in the history for each package? This will allow us to optimize our resources and network consumption.',
        totalSteps: 0,
        steps: []
    }
];
