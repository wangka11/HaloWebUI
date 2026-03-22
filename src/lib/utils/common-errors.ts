type Translate = (key: string, options?: Record<string, unknown>) => string;

const PROVIDER_UNAUTHORIZED_RE = /^([^:]+):\s*(401 Unauthorized|Unauthorized|Not authenticated)$/i;
const SESSION_EXPIRED_PATTERNS = [
	/^401 Unauthorized$/i,
	/^Unauthorized$/i,
	/^Not authenticated$/i,
	/Your session has expired or the token is invalid/i,
	/Could not validate credentials/i,
	/session has expired/i,
	/token is invalid/i
];

const getErrorText = (error: unknown): string => {
	if (typeof error === 'string') {
		return error;
	}

	if (error instanceof Error) {
		return error.message;
	}

	if (error && typeof error === 'object') {
		if ('detail' in error && typeof error.detail === 'string') {
			return error.detail;
		}

		if ('message' in error && typeof error.message === 'string') {
			return error.message;
		}
	}

	return `${error ?? ''}`;
};

export const localizeCommonError = (error: unknown, t: Translate): string => {
	const message = getErrorText(error).trim();

	if (!message) {
		return message;
	}

	const providerUnauthorizedMatch = message.match(PROVIDER_UNAUTHORIZED_RE);
	if (providerUnauthorizedMatch) {
		return `${providerUnauthorizedMatch[1]}: ${t('Unauthorized')}`;
	}

	if (SESSION_EXPIRED_PATTERNS.some((pattern) => pattern.test(message))) {
		return t('Your session has expired. Please log in again.');
	}

	return message;
};
