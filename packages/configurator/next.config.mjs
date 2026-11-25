/**
 * Don't be scared of the generics here.
 * All they do is to give us autocompletion when using this.
 *
 * @template {import('next').NextConfig} T
 * @param {T} config - A generic parameter that flows through to the return type
 * @constraint {{import('next').NextConfig}}
 */
function defineNextConfig(config) {
	return config;
}

export default defineNextConfig({
	reactStrictMode: true,
	distDir: 'dist',
	cleanDistDir: true,
	basePath: '/configure',
	eslint: {
		dirs: ["src/pages", "src/app", "src/server", "src/recoil", "src/data", "src/helpers", "src/hooks", "src/moonraker", "src/__tests__", "src/components", "src/templates", "src/utils", "src/zods"],
	},
	publicRuntimeConfig: {
		// Will be available on both server and client
		basePath: '/configure',	
	},
	headers: async () => {
		return [
			{
				source: '/(.*)',
				headers: [
					{
						key: 'Cross-Origin-Opener-Policy',
						value: 'same-origin',
					},
					{
						key: 'Cross-Origin-Embedder-Policy',
						value: 'require-corp',
					},
				],
			}
		]
	},
	experimental: {
		instrumentationHook: true,
		typedRoutes: true,
	},
	productionBrowserSourceMaps: true,
});
