/**
 * Hook for managing scenario CRUD operations.
 * Extracted from useSimulation for better separation of concerns.
 */
import { useState, useCallback } from 'react';
import type { Trajectory } from '../types';
import { api } from '../services/api';


export interface UseScenarioManagerReturn {
    savedScenarios: Trajectory[];
    refreshScenarios: () => Promise<void>;
    saveScenario: (scenario: Trajectory, idOverride?: string) => Promise<string>;
    deleteScenario: (scenarioId: string) => Promise<void>;
    batchDeleteScenarios: (ids: string[]) => Promise<{ deleted_count: number }>;
    clearAllHistory: () => Promise<void>;
    togglePin: (scenarioId: string) => Promise<void>;
}


export const useScenarioManager = (): UseScenarioManagerReturn => {
    const [savedScenarios, setSavedScenarios] = useState<Trajectory[]>([]);

    // Fetch scenarios from backend
    const refreshScenarios = useCallback(async () => {
        try {
            const saved = await api.listScenarios('benchmark');
            setSavedScenarios(saved);
        } catch (e) {
            console.error("Failed to load saved scenarios", e);
        }
    }, []);

    // Save a scenario
    const saveScenario = useCallback(async (scenario: Trajectory, idOverride?: string): Promise<string> => {
        const idToUse = idOverride || (scenario.id.startsWith("new-") ? undefined : scenario.id);
        const res = await api.saveScenario(scenario.title, scenario, idToUse);
        await refreshScenarios();
        return res.id;
    }, [refreshScenarios]);

    // Delete a single scenario
    const deleteScenario = useCallback(async (scenarioId: string) => {
        try {
            await api.deleteScenario(scenarioId);
            await refreshScenarios();
        } catch (e) {
            console.error("Delete failed", e);
            throw e;
        }
    }, [refreshScenarios]);

    // Batch delete scenarios
    const batchDeleteScenarios = useCallback(async (ids: string[]): Promise<{ deleted_count: number }> => {
        try {
            const result = await api.batchDeleteScenarios(ids);
            console.log(`[INFO] Batch deleted ${result.deleted_count} scenarios`);
            await refreshScenarios();
            return result;
        } catch (e: any) {
            console.error("Batch delete failed", e);
            throw e;
        }
    }, [refreshScenarios]);

    // Clear all history
    const clearAllHistory = useCallback(async () => {
        try {
            console.log("[DEBUG] Starting clearAllHistory...");
            const result = await api.clearAllHistory();
            console.log("[DEBUG] API response:", result);
            await refreshScenarios();
            console.log("[DEBUG] clearAllHistory completed successfully");
        } catch (e: any) {
            console.error("Clear all failed", e);
            const errorMsg = e.response?.data?.detail || e.message || "未知错误";
            throw new Error(`清空失败: ${errorMsg}`);
        }
    }, [refreshScenarios]);

    // Toggle pin status
    const togglePin = useCallback(async (scenarioId: string) => {
        try {
            await api.togglePin(scenarioId);
            await refreshScenarios();
        } catch (e) {
            console.error("Toggle pin failed", e);
            throw e;
        }
    }, [refreshScenarios]);

    return {
        savedScenarios,
        refreshScenarios,
        saveScenario,
        deleteScenario,
        batchDeleteScenarios,
        clearAllHistory,
        togglePin,
    };
};
