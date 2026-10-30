'use strict';

/**
 * Factures et avoirs aux couleurs de Meyana (voir src/invoice-documents.js) :
 * - GET /invoice-documents/:ref?t=     : contenu de la facture (page /facture/:ref du site) ;
 * - GET /invoice-documents/:ref/pdf?t= : le PDF.
 * Sans connexion : l'accès tient à la signature du lien (t).
 */

module.exports = {
	routes: [
		{ method: 'GET', path: '/invoice-documents/:ref', handler: 'invoice-document.show', config: { auth: false } },
		{ method: 'GET', path: '/invoice-documents/:ref/pdf', handler: 'invoice-document.pdf', config: { auth: false } },
	],
};
