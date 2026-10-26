'use strict';
const seedBootstrap = require("./bootstrap");
const registerNotifications = require("./notifications");
const { registerSlotRelease, ensureSlotIndex } = require("./appointment-slots");
const { ensureCharter } = require("./charter");
const { ensurePermission } = require("./permissions");

module.exports = {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }) {
    // Création automatique des notifications (support, rendez-vous, avis…)
    registerNotifications(strapi);
    // Un rendez-vous annulé libère son créneau (verrou anti double réservation)
    registerSlotRelease(strapi);
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }) {
    await seedBootstrap();
    // Index unique des créneaux : refuse en base deux réservations simultanées du même créneau
    await ensureSlotIndex(strapi);
    // Charte éthique : créée avec le texte d'origine si absente, lisible par tous
    await ensureCharter(strapi);
    // Indicateurs /admin : route ouverte aux comptes connectés, réservée au SuperAdmin par son contrôleur
    await ensurePermission(strapi, "authenticated", "api::admin-stats.admin-stats.overview");
  },
};
