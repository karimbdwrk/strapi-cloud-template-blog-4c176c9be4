'use strict';

// Recherche libre des praticiens (chargée avant le routeur principal : /doctors/search ≠ /doctors/:id)
module.exports = {
	routes: [{ method: 'GET', path: '/doctors/search', handler: 'doctor.search' }],
};
