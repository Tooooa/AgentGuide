
import axios from 'axios';

const API_BASE = '';

export interface Scenario {
    id: string;
    query: string;
}

export interface StepResponse {
    thought: string;
    action: string;
    observation: string;
    done: boolean;
    watermark?: {
        bits: string;
        matrixRows: number[][];
        rankContribution: number;
    };
    distribution?: {
        name: string;
        prob: number;
        isSelected: boolean;
    }[];
    stepIndex: number;
}



export const api = {
    async restoreSession(apiKey: string, scenarioId: string) {
        const res = await axios.post(`${API_BASE}/api/restore_session`, {
            apiKey,
            scenarioId
        });
        return res.data;
    },



    initCustomSession: async (apiKey: string, query: string, payload: string) => {
        const response = await axios.post(`${API_BASE}/api/init_custom`, { apiKey, query, payload });
        return response.data; // { sessionId, task, totalSteps }
    },

    step: async (sessionId: string): Promise<StepResponse> => {
        const response = await axios.post(`${API_BASE}/api/step`, { sessionId });
        return response.data;
    },

    continueSession: async (sessionId: string, prompt: string) => {
        const response = await axios.post(`${API_BASE}/api/continue`, { sessionId, prompt });
        return response.data;
    },

    listScenarios: async (type?: string): Promise<any[]> => {
        const url = type
            ? `${API_BASE}/api/scenarios?type=${type}`
            : `${API_BASE}/api/scenarios`;
        const response = await axios.get(url);
        return response.data;
    },

    saveScenario: async (title: any, data: any, id?: string, type: string = "benchmark") => {
        const response = await axios.post(`${API_BASE}/api/save_scenario`, { title, data, id, type });
        return response.data; // { status: "success", id: "..." }
    },

    stepStream: async (sessionId: string, onChunk: (data: any) => void): Promise<void> => {
        const response = await fetch(`${API_BASE}/api/step`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
        });

        // 1221: Throw error on HTTP failures (e.g., 404 session not found)
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        if (!response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const json = JSON.parse(line);
                        onChunk(json);
                    } catch (e) {
                        console.error("Stream parse error", e);
                    }
                }
            }
        }
    },

    generateTitle: async (history: any[]) => {
        const response = await axios.post(`${API_BASE}/api/generate_title`, { history });
        return response.data; // { title: string }
    },

    evaluateSession: async (sessionId: string, language: string = "en") => {
        const response = await axios.post(`${API_BASE}/api/evaluate`, { sessionId, language });
        return response.data;
    },

    deleteScenario: async (scenarioId: string) => {
        const response = await axios.delete(`${API_BASE}/api/scenarios/${scenarioId}`);
        return response.data;
    },

    clearAllHistory: async () => {
        const response = await axios.delete(`${API_BASE}/api/scenarios/clear_all`);
        return response.data;
    },

    batchDeleteScenarios: async (ids: string[]) => {
        const response = await axios.post(`${API_BASE}/api/scenarios/batch_delete`, { ids });
        return response.data;
    },

    togglePin: async (scenarioId: string) => {
        const response = await axios.post(`${API_BASE}/api/scenarios/${scenarioId}/toggle_pin`);
        return response.data;
    }
};
