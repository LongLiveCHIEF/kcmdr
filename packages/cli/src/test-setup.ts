import { vi } from 'vitest';
import { loadConfiguratorTestEnvironment } from '@/cli/test-env';

export const setup = () => {
	// Mock server-only imports to avoid errors during tests
	vi.mock('server-only', () => ({}));
};

// Code under test calls loadEnvironment() without a path, which would look for .env
// files in packages/cli. Load the configurator's file in each worker up front so
// those calls reuse it.
try {
	loadConfiguratorTestEnvironment();
} catch (error) {
	// eslint-disable-next-line no-console
	console.warn('Warning: Could not load environment file, using existing process.env');
}
