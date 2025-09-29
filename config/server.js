module.exports = ({ env }) => ({
	host: env("HOST", "0.0.0.0"),
	port: env.int("PORT", 1337),
	app: {
		keys: env.array("APP_KEYS"),
	},
	apiToken: {
		salt: env("API_TOKEN_SALT"),
	},
	jwt: {
		secret: env("JWT_SECRET"),
	},
	webhooks: {
		populateRelations: env.bool("WEBHOOKS_POPULATE_RELATIONS", false),
	},
});
