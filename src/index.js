'use strict';
const seedBootstrap = require("./bootstrap");
const registerNotifications = require("./notifications");
const { registerSlotRelease, ensureSlotIndex } = require("./appointment-slots");
const { ensureCharter } = require("./charter");
const { ensurePermission, revokePermission } = require("./permissions");
const { registerRatingScore, ensureDoctorRatings } = require("./rating-score");
const { ensureProfessions } = require("./professions");
const { registerKeywords, ensureKeywords } = require("./keywords");

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
    // Note globale du praticien recalculée à chaque avis (première note fictive à 5/5)
    registerRatingScore(strapi);
    // Mots-clés : texte de recherche normalisé, effets de la modération (validation, refus)
    registerKeywords(strapi);
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
    // Métiers référencés et familles de métiers (Médical, Paramédical, Bien-être) : ajoutés s'ils manquent
    await ensureProfessions(strapi);
    // Liste Meyana des mots-clés de recherche (après les métiers, auxquels ils sont rattachés)
    await ensureKeywords(strapi);
    // Indicateurs /admin : permission du rôle SuperAdmin (Strapi vérifie le rôle du compte connecté),
    // le contrôleur revérifie le rôle
    await ensurePermission(strapi, { name: "SuperAdmin" }, "api::admin-stats.admin-stats.overview");
    // Signalements : chacun crée et suit les siens (le contrôleur filtre), l'admin traite
    for (const action of ["create", "find", "findOne"]) {
      await ensurePermission(strapi, { type: "authenticated" }, `api::reporting.reporting.${action}`);
    }
    for (const action of ["create", "find", "findOne", "update", "delete"]) {
      await ensurePermission(strapi, { name: "SuperAdmin" }, `api::reporting.reporting.${action}`);
    }
    // Avis : lecture réservée à l'admin. Sans cette permission, Strapi retire aussi les avis
    // des populate (doctor.ratings, appointment.rating) : le praticien ne voit que sa note globale
    for (const role of [{ type: "public" }, { type: "authenticated" }]) {
      for (const action of ["find", "findOne"]) await revokePermission(strapi, role, `api::rating.rating.${action}`);
    }
    for (const action of ["find", "findOne", "update", "delete"]) {
      await ensurePermission(strapi, { name: "SuperAdmin" }, `api::rating.rating.${action}`);
    }
    await ensureDoctorRatings(strapi);
  },
};
