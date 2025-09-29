'use strict';

/**
 * reporting service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::reporting.reporting');
