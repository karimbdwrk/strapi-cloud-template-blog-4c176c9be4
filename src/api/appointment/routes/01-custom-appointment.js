'use strict';

/**
 * Routes complémentaires des rendez-vous.
 * Le préfixe « 01- » les charge avant le routeur principal (sinon
 * « to-rate-count » serait pris pour un :id).
 */

module.exports = {
	routes: [
		{
			method: 'GET',
			path: '/appointments/to-rate-count',
			handler: 'appointment.toRateCount',
		},
	],
};
