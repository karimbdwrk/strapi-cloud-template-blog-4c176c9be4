'use strict';

/**
 * Indicateurs de la vue d'ensemble /admin (SuperAdmin uniquement, contrôlé dans le contrôleur).
 * La permission du rôle SuperAdmin est accordée au démarrage (src/index.js).
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
