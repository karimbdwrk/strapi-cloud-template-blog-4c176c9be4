'use strict';

/**
 * charter service.
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::charter.charter');
