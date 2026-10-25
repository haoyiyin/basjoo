import { useCallback, useEffect, useState } from "react";
import { api } from "../services/api";
import type { KbStatusPayload } from "../services/api";

interface AgentKbStatusState {
	loading: boolean;
	error: string | null;
	/** True only when the agent has a bound KB whose status is `active`. */
	kbSetupCompleted: boolean;
	raw: KbStatusPayload | null;
	recheck: () => Promise<void>;
}

/**
 * Derived KB binding state for one agent.
 *
 * The backend computes `kb_setup_completed` from `agent.kb_id` plus the KB
 * status, so this hook never inspects legacy agent embedding fields.
 */
export function useAgentKbStatus(agentId: string | null): AgentKbStatusState {
	const [loading, setLoading] = useState<boolean>(Boolean(agentId));
	const [error, setError] = useState<string | null>(null);
	const [kbSetupCompleted, setKbSetupCompleted] = useState(false);
	const [raw, setRaw] = useState<KbStatusPayload | null>(null);

	const fetchStatus = useCallback(async () => {
		if (!agentId) return;
		setLoading(true);
		setError(null);
		try {
			const status = await api.kbStatus(agentId);
			setRaw(status);
			setKbSetupCompleted(status.kb_setup_completed);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load KB status");
		} finally {
			setLoading(false);
		}
	}, [agentId]);

	useEffect(() => {
		if (!agentId) {
			setLoading(false);
			return;
		}
		fetchStatus();
	}, [agentId, fetchStatus]);

	return { loading, error, kbSetupCompleted, raw, recheck: fetchStatus };
}
