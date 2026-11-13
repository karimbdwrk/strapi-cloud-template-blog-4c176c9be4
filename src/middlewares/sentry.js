'use strict';

const { captureError } = require('../sentry');

/**
 * Erreurs des routes de l'API envoyées à Sentry (placé juste après strapi::errors).
 * Les erreurs prévues (400, 401, 403, 404…) ne sont pas remontées : seulement les pannes.
 */
module.exports = () => async (ctx, next) => {
	try {
		await next();
	} catch (error) {
		const status = error?.status || error?.statusCode || 500;
		if (status >= 500) {
			captureError(error, {
				route: ctx._matchedRoute || ctx.path?.replace(/\/[a-z0-9]{20,}(?=\/|$)/gi, '/:id'),
				method: ctx.method,
				userId: ctx.state?.user?.id,
			});
		}
		throw error;
	}
};
