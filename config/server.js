module.exports = ({ env }) => ({
	host: env("HOST", "0.0.0.0"),
	port: env.int("PORT", 1337),
	app: {
		keys: ["jdiVRmuuxOpvSvr/cAbJyg==", "cfT/u+SsPjau/z2vPK0+bQ=="],
	},
	apiToken: {
		salt: "AFlAihDgHLkOsJeXKogKbA==",
	},
	jwt: {
		secret: "8qKjF9hB7nS4mR3lW2jP1oN0iYxZcVaT7uE6dC5bA4zY3xV8rQW0eM9pL7kI6jH5gY4fE3dC2bA1zY0w=",
	},
	webhooks: {
		populateRelations: env.bool("WEBHOOKS_POPULATE_RELATIONS", false),
	},
});
