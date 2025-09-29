module.exports = ({ env }) => ({
	"users-permissions": {
		config: {
			jwtSecret: env("JWT_SECRET"),
		},
	},
	"import-export-entries": {
		enabled: true,
	},
});
