/**
 * Connexion des patients et praticiens (users-permissions).
 *
 * AUTH_SESSION_COOKIE=true : sessions avec rotation. Le site garde en mémoire un jeton d'accès
 * court (15 min) et le renouvelle avec un jeton de session rangé dans un cookie httpOnly, que
 * le code du site ne peut pas lire (un script injecté ne peut donc pas voler la session).
 * La déconnexion révoque la session côté serveur.
 * Prérequis : l'API servie sur un sous-domaine du site (ex. api.meyana.fr pour meyana.fr),
 * sinon le navigateur ne renvoie pas le cookie. À activer en même temps côté site.
 *
 * Sans la variable : ancien fonctionnement (jeton de 30 jours gardé par le site).
 */
module.exports = ({ env }) => {
	const sessionCookie = env.bool("AUTH_SESSION_COOKIE", false);
	return {
		"users-permissions": {
			config: {
				jwtSecret: env("JWT_SECRET"),
				...(sessionCookie && {
					jwtManagement: "refresh",
					sessions: {
						// Durée du jeton d'accès (secondes), 15 min par défaut
						accessTokenLifespan: env.int("AUTH_ACCESS_TOKEN_LIFESPAN", 15 * 60),
						// Reconnexion demandée après 14 jours sans visite, et au plus tard après 30 jours
						idleRefreshTokenLifespan: 14 * 24 * 60 * 60,
						maxRefreshTokenLifespan: 30 * 24 * 60 * 60,
						idleSessionLifespan: 2 * 60 * 60,
						maxSessionLifespan: 24 * 60 * 60,
						httpOnly: true,
						cookie: {
							name: "meyana_session",
							// Envoyé uniquement aux routes /api/auth (renouvellement, déconnexion)
							path: "/api/auth",
							sameSite: "lax",
							// Vide : cookie réservé au domaine de l'API (le plus restrictif)
							domain: env("AUTH_COOKIE_DOMAIN", undefined),
							secure: env.bool("AUTH_COOKIE_SECURE", env("NODE_ENV") === "production"),
						},
					},
				}),
			},
		},
	};
};
