import { get } from 'svelte/store';

import { getModels as apiGetModels } from '$lib/apis';
import { config, models, modelsError, modelsStatus, settings } from '$lib/stores';
import type { Model } from '$lib/stores';

const MODELS_TTL_MS = 5 * 60 * 1000;

let inFlight: Promise<Model[]> | null = null;
let lastFetchedAt = 0;

const getDirectConnections = () => {
	const cfg = get(config) as any;
	const s = get(settings) as any;
	if (cfg?.features?.enable_direct_connections) {
		return s?.directConnections ?? null;
	}
	return null;
};

const stringifyError = (error: unknown) => {
	if (typeof error === 'string') return error;
	if (error instanceof Error) return error.message;
	if (error && typeof error === 'object' && 'detail' in error) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const detail = (error as any).detail;
			if (typeof detail === 'string') return detail;
			return JSON.stringify(detail);
		} catch {
			return 'Failed to load models';
		}
	}
	try {
		return JSON.stringify(error);
	} catch {
		return 'Failed to load models';
	}
};

export const refreshModels = async (
	token: string,
	opts: { force?: boolean; reason?: string } = {}
) => {
	const current = get(models) ?? [];
	const isFresh = current.length > 0 && Date.now() - lastFetchedAt < MODELS_TTL_MS;
	if (!opts.force && isFresh && !inFlight) return current;

	// De-dup concurrent refreshes.
	if (inFlight) return inFlight;

	modelsStatus.set('loading');
	modelsError.set(null);

	inFlight = (async () => {
		try {
			const next = await apiGetModels(token, getDirectConnections());
			models.set(next);
			modelsStatus.set('ready');
			modelsError.set(null);
			lastFetchedAt = Date.now();
			return next;
		} catch (error) {
			modelsStatus.set('error');
			modelsError.set(stringifyError(error));
			throw error;
		} finally {
			inFlight = null;
		}
	})();

	return inFlight;
};

export const ensureModels = async (token: string, opts: { reason?: string } = {}) => {
	const current = get(models) ?? [];

	if (inFlight) return inFlight;

	const isFresh = current.length > 0 && Date.now() - lastFetchedAt < MODELS_TTL_MS;
	if (isFresh) return current;

	if (current.length > 0) {
		void refreshModels(token, { reason: opts.reason }).catch(() => {});
		return current;
	}

	return refreshModels(token, { reason: opts.reason });
};
