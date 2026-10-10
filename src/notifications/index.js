'use strict';

/**
 * Création automatique des notifications.
 *
 * On passe par un middleware du document service (Strapi v5) plutôt que par
 * des lifecycles de base de données : il est appelé une seule fois par action,
 * même sur les collections avec Draft & Publish (où les lifecycles se
 * déclenchent pour le brouillon ET la version publiée).
 *
 * Chaque domaine a son fichier, qui exporte :
 * - uids : les collections qui le concernent
 * - before(strapi, context) (facultatif) : état AVANT l'action (pour comparer)
 * - handle(strapi, context, result, previous) : crée les notifications
 */

const handlers = [
	require('./support'),
	require('./appointments'),
	require('./doctors'),
	require('./reviews'),
];

module.exports = (strapi) => {
	strapi.documents.use(async (context, next) => {
		const concerned = handlers.filter((h) => !h.uids || h.uids.includes(context.uid));
		if (!concerned.length) return next();

		// État avant l'action (ex. ancien statut d'un praticien)
		const previous = new Map();
		for (const handler of concerned) {
			if (!handler.before) continue;
			try {
				previous.set(handler, await handler.before(strapi, context));
			} catch (error) {
				strapi.log.error(`[notifications] before ${context.uid}.${context.action} : ${error.message}`);
			}
		}

		const result = await next();

		// Les notifications ne bloquent jamais l'action d'origine
		for (const handler of concerned) {
			Promise.resolve()
				.then(() => handler.handle(strapi, context, result, previous.get(handler)))
				.catch((error) => strapi.log.error(`[notifications] ${context.uid}.${context.action} : ${error.message}`));
		}

		return result;
	});
};
