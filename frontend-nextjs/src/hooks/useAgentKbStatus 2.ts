import { useCallback, useEffect, useState } from "react";
import { api } from "../services/api";

interface AgentKbStatusState {
	loading: boolean;
	error: string | null;
	kbSetupCompleted: boolean;
	raw: Awaited<ReturnType<typeof api.kbStatus>> | null;
	recheck: () => Promise<void>;
}

export function useAgentKbStatus(agentId: string | null): AgentKbStatusState {
	const [loading, setLoading] = useState<boolean>(Boolean(agentId));
	const [error, setError] = useState<string | null>(null);
	const [kbSetupCompleted, setKbSetupCompleted] = useState(false);
	const [raw, setRaw] = useState<Awaited<
		ReturnType<typeof api.kbStatus>
	> | null>(null);

	const fetchStatus = useCallback(async () => {
		if (!agentId) return;
		setLoading(true);
		setError(null);
		try {
			const status = await api.kbStatus(agentId);
			setRaw(status);
			setKbSetupCompleted(Boolean(status.kb_setup_completed));
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
