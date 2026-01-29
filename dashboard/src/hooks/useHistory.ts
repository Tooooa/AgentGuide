import { useState, useEffect, useCallback } from 'react';
import type { Trajectory } from '../types';
import { api } from '../services/api';

export interface UseHistoryReturn {
    savedScenarios: Trajectory[];
    setSavedScenarios: React.Dispatch<React.SetStateAction<Trajectory[]>>;
    refreshScenarios: () => Promise<void>;
    deleteScenario: (scenarioId: string) => Promise<void>;
    clearAllHistory: () => Promise<void>;
    batchDeleteScenarios: (ids: string[]) => Promise<any>;
    togglePin: (scenarioId: string) => Promise<void>;
}

export const useHistory = (): UseHistoryReturn => {
    const [savedScenarios, setSavedScenarios] = useState<Trajectory[]>([]);

    const refreshScenarios = useCallback(async () => {
        try {
            const saved = await api.listScenarios('benchmark');
            setSavedScenarios(saved);
        } catch (e) {
            console.error("Failed to load saved scenarios", e);
        }
    }, []);

    useEffect(() => {
        refreshScenarios();
    }, [refreshScenarios]);

    const deleteScenario = useCallback(async (scenarioId: string) => {
        try {
            await api.deleteScenario(scenarioId);
        } catch (e) {
            console.error("Delete failed", e);
            throw e;
        }
    }, []);

    const clearAllHistory = useCallback(async () => {
        try {
            await api.clearAllHistory();
            // Clear local state immediately to update UI
            setSavedScenarios([]);
        } catch (e) {
            console.error("Clear all failed", e);
            throw e;
        }
    }, []);

    const batchDeleteScenarios = useCallback(async (ids: string[]) => {
        try {
            const result = await api.batchDeleteScenarios(ids);
            return result;
        } catch (e) {
            console.error("Batch delete failed", e);
            throw e;
        }
    }, []);

    const togglePin = useCallback(async (scenarioId: string) => {
        try {
            await api.togglePin(scenarioId);
        } catch (e) {
            console.error("Toggle pin failed", e);
            throw e;
        }
    }, []);

    return {
        savedScenarios,
        setSavedScenarios,
        refreshScenarios,
        deleteScenario,
        clearAllHistory,
        batchDeleteScenarios,
        togglePin
    };
};
