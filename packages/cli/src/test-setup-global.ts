import { resetEnvironment } from '@/server/helpers/utils';
import { loadConfiguratorTestEnvironment } from '@/cli/test-env';

export const setup = () => {
	// Set NODE_ENV to test if not already set
	if (!process.env.NODE_ENV) {
		(process.env as any).NODE_ENV = 'test';
	}

	// Reset environment loading state to ensure fresh load
	resetEnvironment();

	try {
		loadConfiguratorTestEnvironment();
	} catch (error) {
		// If environment loading fails, continue with existing process.env
		// This allows tests to run even if .env files are missing
		// eslint-disable-next-line no-console
		console.warn('Warning: Could not load environment file, using existing process.env');
	}
};
