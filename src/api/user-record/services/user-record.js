'use strict';

/**
 * user-record service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::user-record.user-record');
