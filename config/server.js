module.exports = ({ env }) => ({
	host: env("HOST", "0.0.0.0"),
	port: env.int("PORT", 1337),
	// Derrière le proxy HTTPS de l'hébergeur : nécessaire pour poser un cookie « secure »
	proxy: { koa: env.bool("IS_PROXIED", env("NODE_ENV") === "production") },
	app: {
		keys: env.array("APP_KEYS"),
	},
	apiToken: {
		salt: env("API_TOKEN_SALT"),
	},
	jwt: {
		secret: env("JWT_SECRET"),
	},
	cron: {
		enabled: true,
		tasks: require('./cron-tasks'),
	},
	webhooks: {
		populateRelations: env.bool("WEBHOOKS_POPULATE_RELATIONS", false),
	},
});
