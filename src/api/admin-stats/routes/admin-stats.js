'use strict';

/**
 * Indicateurs de la vue d'ensemble /admin (SuperAdmin uniquement, contrôlé dans le contrôleur).
 * La permission « Authenticated » est accordée au démarrage (src/permissions.js).
 */

module.exports = {
	routes: [
		{
			method: 'GET',
			path: '/admin-stats/overview',
			handler: 'admin-stats.overview',
		},
	],
};
