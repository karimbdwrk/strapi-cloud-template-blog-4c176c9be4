'use strict';
const seedBootstrap = require("./bootstrap");
const registerNotifications = require("./notifications");
const { registerSlotRelease, ensureSlotIndex } = require("./appointment-slots");
const { ensureCharter } = require("./charter");
const { ensurePermission, revokePermission } = require("./permissions");
const { setupBilling } = require("./billing");
const { syncBillingCustomers, refreshInvoiceLinks } = require("./invoices");
const { registerRatingScore, ensureDoctorRatings } = require("./rating-score");
const { ensureProfessions } = require("./professions");
const { registerKeywords, ensureKeywords } = require("./keywords");
const { scheduleAddressGeocoding } = require("./address-geocoding");
const { ensureNewsletterTokens } = require("./newsletter");

/**
 * Droits jamais accordés aux rôles Public et Authenticated :
 * - comptes utilisateurs : lister tous les comptes (emails) ou modifier celui d'un autre
 *   (bloquer, changer l'email ou le rôle). Le compte connecté passe par /users/me, et les
 *   contrôleurs ajoutent eux-mêmes le patient / le demandeur quand c'est utile ;
 * - rôles : lecture et gestion des rôles ;
 * - métiers : création, modification, suppression (l'admin Meyana passe par /categories/admin) ;
 * - fichiers : lister, lire ou supprimer tous les fichiers envoyés (documents médicaux compris).
 *   L'envoi d'un fichier (upload) reste permis.
 */
const FORBIDDEN_FOR_USERS = [
  "plugin::users-permissions.user.find",
  "plugin::users-permissions.user.findOne",
  "plugin::users-permissions.user.count",
  "plugin::users-permissions.user.create",
  "plugin::users-permissions.user.update",
  "plugin::users-permissions.user.destroy",
  "plugin::users-permissions.role.find",
  "plugin::users-permissions.role.findOne",
  "plugin::users-permissions.role.createRole",
  "plugin::users-permissions.role.updateRole",
  "plugin::users-permissions.role.deleteRole",
  "api::category.category.create",
  "api::category.category.update",
  "api::category.category.delete",
  "plugin::upload.content-api.find",
  "plugin::upload.content-api.findOne",
  "plugin::upload.content-api.destroy",
  // Newsletter : plus de routes CRUD (routes sur mesure, liste des inscrits jamais exposée)
  "api::newsletter.newsletter.find",
  "api::newsletter.newsletter.findOne",
  "api::newsletter.newsletter.create",
  "api::newsletter.newsletter.update",
  "api::newsletter.newsletter.delete",
];

const lockDownAuthenticatedRole = async (strapi) => {
  for (const role of [{ type: "public" }, { type: "authenticated" }]) {
    for (const action of FORBIDDEN_FOR_USERS) await revokePermission(strapi, role, action);
  }
};

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
    // Sécurité : droits retirés aux comptes connectés (patients, praticiens), réservés au SuperAdmin.
    // Appliqué à chaque démarrage : une case recochée par erreur dans le panneau Strapi est décochée.
    await lockDownAuthenticatedRole(strapi);
    // Newsletter : jeton de désinscription des anciens inscrits, export CSV réservé à l'admin
    await ensureNewsletterTokens(strapi);
    await ensurePermission(strapi, { name: "SuperAdmin" }, "api::newsletter.newsletter.export");
    // Index unique des créneaux : refuse en base deux réservations simultanées du même créneau
    await ensureSlotIndex(strapi);
    // Charte éthique : créée avec le texte d'origine si absente, lisible par tous
    await ensureCharter(strapi);
    // Métiers référencés et familles de métiers (Médical, Paramédical, Bien-être) : ajoutés s'ils manquent
    await ensureProfessions(strapi);
    // Gestion des métiers depuis l'admin Meyana (le contrôleur revérifie le rôle)
    for (const action of ["adminList", "adminCreate", "adminUpdate", "adminDelete"]) {
      await ensurePermission(strapi, { name: "SuperAdmin" }, `api::category.category.${action}`);
    }
    // Liste Meyana des mots-clés de recherche (après les métiers, auxquels ils sont rattachés)
    await ensureKeywords(strapi);
    // Adresses de cabinet saisies à la main : ville et code postal vérifiés (tâche de fond)
    scheduleAddressGeocoding(strapi);
    // Indicateurs /admin : permission du rôle SuperAdmin (Strapi vérifie le rôle du compte connecté),
    // le contrôleur revérifie le rôle
    await ensurePermission(strapi, { name: "SuperAdmin" }, "api::admin-stats.admin-stats.overview");
    await ensurePermission(strapi, { name: "SuperAdmin" }, "api::admin-payment.admin-payment.overview");
    // L'admin ouvre les factures de consultation depuis sa page Paiements
    await ensurePermission(strapi, { name: "SuperAdmin" }, "api::appointment.appointment.invoiceLinks");
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
    // Audience : le praticien lit celle de sa fiche, l'admin celle du site (contrôleurs revérifient)
    await ensurePermission(strapi, { type: "authenticated" }, "api::page-view.page-view.mine");
    for (const action of ["site", "doctors"]) {
      await ensurePermission(strapi, { name: "SuperAdmin" }, `api::page-view.page-view.${action}`);
    }
    // Abonnements : le praticien gère le sien, l'admin offre des mois (contrôleurs revérifient)
    for (const action of ["mine", "subscribe", "confirm", "portal", "sync"]) {
      await ensurePermission(strapi, { type: "authenticated" }, `api::billing.billing.${action}`);
    }
    // Ancienne page de paiement hébergée, remplacée par /billing/subscribe
    await revokePermission(strapi, { type: "authenticated" }, "api::billing.billing.checkout");
    for (const action of ["doctor", "offer", "offerAll"]) {
      await ensurePermission(strapi, { name: "SuperAdmin" }, `api::billing.billing.${action}`);
    }
    // Paiement des consultations : le patient confirme ou abandonne son paiement, le praticien gère ses versements
    for (const action of ["confirmPayment", "abandonPayment", "payments", "invoiceLinks"]) {
      await ensurePermission(strapi, { type: "authenticated" }, `api::appointment.appointment.${action}`);
    }
    for (const action of ["mine", "onboarding", "dashboard", "invoices", "billingInfo"]) {
      await ensurePermission(strapi, { type: "authenticated" }, `api::payout.payout.${action}`);
    }
    // Catalogue Stripe (formules Premium, portail client) créé s'il manque
    await setupBilling(strapi);
    // Clients Stripe des praticiens : nom, adresse, SIRET et mention de TVA sur les factures Meyana
    syncBillingCustomers(strapi).catch((error) => strapi.log.error(`Factures : clients non synchronisés (${error.message})`));
    refreshInvoiceLinks(strapi).catch((error) => strapi.log.error(`Factures : liens non mis à jour (${error.message})`));
  },
};
