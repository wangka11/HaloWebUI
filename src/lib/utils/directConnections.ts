type Tag = { name: string };

export type DirectConnectionConfig = {
	enable?: boolean;
	tags?: Tag[];
	model_ids?: string[];
	use_responses_api?: boolean;
	native_file_inputs_enabled?: boolean;
	/**
	 * Internal stable identifier used to prefix model IDs to avoid conflicts.
	 * Kept for backward compatibility with existing configs and chats.
	 */
	prefix_id?: string;
	/** User-facing connection name, used for display only. */
	name?: string;
};

export type DirectConnectionsSettings = {
	OPENAI_API_BASE_URLS: string[];
	OPENAI_API_KEYS: string[];
	OPENAI_API_CONFIGS: Record<string, DirectConnectionConfig>;
};

export function deriveConnectionNameFromUrl(url: string): string {
	try {
		const u = new URL(url);
		return u.hostname || url;
	} catch {
		return url;
	}
}

function bytesToHex(bytes: Uint8Array): string {
	let out = '';
	for (const b of bytes) out += b.toString(16).padStart(2, '0');
	return out;
}

export function generateConnectionPrefixId(): string {
	// 32-bit randomness -> 8 hex chars, extremely low collision risk.
	try {
		const bytes = new Uint8Array(4);
		crypto.getRandomValues(bytes);
		return bytesToHex(bytes);
	} catch {
		// Fallback: not cryptographically strong, but better than blocking UI.
		return Math.floor(Math.random() * 0xffffffff)
			.toString(16)
			.padStart(8, '0');
	}
}

export function stripPrefixedModelId(modelId: string, prefixId?: string): string {
	if (!prefixId) return modelId;
	const p = `${prefixId}.`;
	return modelId.startsWith(p) ? modelId.slice(p.length) : modelId;
}

function normalizeModelIds(
	modelIds: unknown,
	prefixId?: string
): { modelIds: string[]; changed: boolean } {
	const input = Array.isArray(modelIds) ? (modelIds as unknown[]) : [];
	let changed = false;

	const out: string[] = [];
	for (const raw of input) {
		if (typeof raw !== 'string') {
			changed = true;
			continue;
		}
		const trimmed = raw.trim();
		if (!trimmed) {
			changed = true;
			continue;
		}

		const stripped = stripPrefixedModelId(trimmed, prefixId);
		if (stripped !== trimmed) changed = true;
		out.push(stripped);
	}

	return { modelIds: out, changed };
}

export function normalizeDirectConnectionsConfig(
	input: Partial<DirectConnectionsSettings> | null | undefined
): { config: DirectConnectionsSettings; changed: boolean } {
	const config: DirectConnectionsSettings = {
		OPENAI_API_BASE_URLS: [...(input?.OPENAI_API_BASE_URLS ?? [])],
		OPENAI_API_KEYS: [...(input?.OPENAI_API_KEYS ?? [])],
		OPENAI_API_CONFIGS: { ...(input?.OPENAI_API_CONFIGS ?? {}) }
	};

	let changed = false;

	// Normalize URLs (remove trailing slash)
	const normalizedUrls = config.OPENAI_API_BASE_URLS.map((url) => url.replace(/\/$/, ''));
	if (normalizedUrls.join('|') !== config.OPENAI_API_BASE_URLS.join('|')) {
		config.OPENAI_API_BASE_URLS = normalizedUrls;
		changed = true;
	}

	// Keep keys aligned with URLs length
	if (config.OPENAI_API_KEYS.length !== config.OPENAI_API_BASE_URLS.length) {
		changed = true;
		if (config.OPENAI_API_KEYS.length > config.OPENAI_API_BASE_URLS.length) {
			config.OPENAI_API_KEYS = config.OPENAI_API_KEYS.slice(0, config.OPENAI_API_BASE_URLS.length);
		} else {
			while (config.OPENAI_API_KEYS.length < config.OPENAI_API_BASE_URLS.length) {
				config.OPENAI_API_KEYS.push('');
			}
		}
	}

	// Ensure configs exist for every url index
	const nextConfigs: Record<string, DirectConnectionConfig> = {};
	for (let idx = 0; idx < config.OPENAI_API_BASE_URLS.length; idx++) {
		const key = String(idx);
		const existing = config.OPENAI_API_CONFIGS[key] ?? {};
		nextConfigs[key] = { ...existing };
	}
	if (Object.keys(nextConfigs).length !== Object.keys(config.OPENAI_API_CONFIGS).length) {
		changed = true;
	}
	config.OPENAI_API_CONFIGS = nextConfigs;

	// Ensure prefix_id uniqueness + ensure name
	const connectionCount = config.OPENAI_API_BASE_URLS.length;
	const used = new Set<string>();
	let preservedEmptyPrefixIdx: number | null = null;

	// Preserve an empty prefix only for backward compatibility:
	// - single connection: allow empty prefix (keeps existing model ids stable)
	// - multiple connections: only preserve an empty prefix if it already existed in config (explicitly),
	//   or if we're migrating a legacy multi-connection config where >=2 connections are missing prefix_id.
	let explicitEmptyIdx: number | null = null;
	let missingPrefixCount = 0;
	for (let idx = 0; idx < connectionCount; idx++) {
		const apiConfig = config.OPENAI_API_CONFIGS[String(idx)] ?? {};
		const raw = apiConfig.prefix_id;
		const trimmed = (raw ?? '').toString().trim();
		if (!trimmed) missingPrefixCount++;

		// "Explicit empty" means the field exists (e.g. migrated legacy config) and is intentionally empty.
		if (
			explicitEmptyIdx === null &&
			Object.prototype.hasOwnProperty.call(apiConfig, 'prefix_id') &&
			!trimmed
		) {
			explicitEmptyIdx = idx;
		}
	}

	if (connectionCount === 1) {
		if (missingPrefixCount === 1) preservedEmptyPrefixIdx = 0;
	} else {
		if (explicitEmptyIdx !== null) {
			preservedEmptyPrefixIdx = explicitEmptyIdx;
		} else if (missingPrefixCount >= 2) {
			// Best-effort migration: keep the first connection unprefixed, generate prefixes for others.
			preservedEmptyPrefixIdx = 0;
			changed = true;
		}
	}

	for (let idx = 0; idx < connectionCount; idx++) {
		const key = String(idx);
		const apiConfig = config.OPENAI_API_CONFIGS[key] ?? {};

		let prefixId = (apiConfig.prefix_id ?? '').trim();
		if (!prefixId) {
			if (preservedEmptyPrefixIdx === idx) {
				// Keep an explicit empty marker so future normalizations can distinguish legacy "no prefix"
				// from newly-added connections that haven't been assigned a prefix yet.
				prefixId = '';
			} else {
				prefixId = generateConnectionPrefixId();
				changed = true;
			}
		}

		if (prefixId) {
			// De-conflict duplicates (rare unless user manually duplicated old prefix_id)
			if (used.has(prefixId)) {
				let next = prefixId;
				do {
					next = generateConnectionPrefixId();
				} while (used.has(next));
				prefixId = next;
				changed = true;
			}
			used.add(prefixId);
		}

		let name = (apiConfig.name ?? '').trim();
		if (!name) {
			name =
				deriveConnectionNameFromUrl(config.OPENAI_API_BASE_URLS[idx]) || `Connection ${idx + 1}`;
			changed = true;
		}

		const normalizedModelIds = normalizeModelIds(apiConfig.model_ids, prefixId || undefined);
		if (normalizedModelIds.changed) changed = true;

		config.OPENAI_API_CONFIGS[key] = {
			...apiConfig,
			prefix_id: prefixId === '' ? '' : prefixId || undefined,
			name,
			model_ids: normalizedModelIds.modelIds
		};
	}

	return { config, changed };
}
