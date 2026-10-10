'use strict';

/**
 * notification router
 * Seules la lecture et la mise à jour (lu / non lu) sont exposées.
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::notification.notification', {
	only: ['find', 'findOne', 'update'],
});
