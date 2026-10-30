'use strict';

/**
 * Page « Paiements » de l'admin (SuperAdmin uniquement, contrôlé dans le contrôleur) :
 * GET /admin-payments/overview?period=7d|30d|3m|6m|12m (voir src/admin-payments.js).
 */

module.exports = {
	routes: [
		{
			method: 'GET',
			path: '/admin-payments/overview',
			handler: 'admin-payment.overview',
		},
	],
};
