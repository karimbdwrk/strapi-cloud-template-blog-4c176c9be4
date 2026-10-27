'use strict';

/**
 * Routes complémentaires des avis.
 * Le préfixe « 01- » les charge avant le routeur principal (sinon
 * « testimonials » serait pris pour un :id).
 */

module.exports = {
	routes: [
		{
			// Avis de la page d'accueil : moyennes et commentaires anonymes, public
			method: 'GET',
			path: '/ratings/testimonials',
			handler: 'rating.testimonials',
			config: { auth: false },
		},
	],
};
