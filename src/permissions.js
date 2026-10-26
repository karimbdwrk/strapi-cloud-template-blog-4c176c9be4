'use strict';

/**
 * Accorde une action à un rôle users-permissions, une seule fois.
 * `role` : un filtre sur le rôle, par type ({ type: 'public' }) ou par nom ({ name: 'SuperAdmin' }).
 */
const ensurePermission = async (strapi, role, action) => {
	const found = await strapi.query('plugin::users-permissions.role').findOne({ where: role });
	if (!found) {
		strapi.log.warn(`Permission ${action} non accordée : rôle introuvable (${JSON.stringify(role)})`);
		return;
	}
	const permissions = strapi.query('plugin::users-permissions.permission');
	if (!(await permissions.findOne({ where: { action, role: found.id } }))) {
		await permissions.create({ data: { action, role: found.id } });
	}
};

module.exports = { ensurePermission };
