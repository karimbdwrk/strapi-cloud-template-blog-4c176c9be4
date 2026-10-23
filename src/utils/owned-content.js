'use strict';

/**
 * Outils pour les collections rattachées à un compte (relation vers le modèle User).
 *
 * Strapi 5 refuse (400 « Invalid key ») un filtre ou un populate explicite sur une
 * relation vers un modèle que le rôle ne peut pas lire — c'est le cas du modèle User
 * pour les utilisateurs connectés. Les contrôleurs retirent donc ces clés de la requête
 * du navigateur, puis appliquent eux-mêmes, côté serveur, le filtre « compte connecté »
 * et l'ajout des informations utiles du compte.
 */

const ADMIN_ROLE = 'SuperAdmin';

const isAdmin = (user) => user?.role?.name === ADMIN_ROLE;

// Champs d'un compte transmis au navigateur (jamais le mot de passe, le rôle, les jetons…)
const PUBLIC_USER_FIELDS = ['id', 'documentId', 'firstname', 'lastname', 'email'];

/** Retire `key` d'un populate (chaîne, tableau ou objet). Renvoie { populate, removed }. */
const withoutPopulate = (populate, key) => {
	if (!populate) return { populate, removed: false };
	if (populate === key) return { populate: undefined, removed: true };
	if (Array.isArray(populate)) {
		const rest = populate.filter((p) => p !== key && !String(p).startsWith(`${key}.`));
		return { populate: rest.length ? rest : undefined, removed: rest.length !== populate.length };
	}
	if (typeof populate === 'object' && key in populate) {
		const { [key]: _removed, ...rest } = populate;
		return { populate: Object.keys(rest).length ? rest : undefined, removed: true };
	}
	return { populate, removed: false };
};

/** Retire `key` des filtres de premier niveau. */
const withoutFilter = (filters, key) => {
	if (!filters || typeof filters !== 'object' || !(key in filters)) return filters;
	const { [key]: _removed, ...rest } = filters;
	return rest;
};

module.exports = { ADMIN_ROLE, isAdmin, PUBLIC_USER_FIELDS, withoutPopulate, withoutFilter };
