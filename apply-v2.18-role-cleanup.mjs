import fs from 'node:fs';

const INDEX_PATH = 'src/index.js';
const PACKAGE_PATH = 'package.json';

if (!fs.existsSync(INDEX_PATH)) {
  console.error(`[PATCH] Could not find ${INDEX_PATH}. Run this from the root of your goats bot repository.`);
  process.exit(1);
}

let src = fs.readFileSync(INDEX_PATH, 'utf8');

function replaceOnce(haystack, needle, replacement, label) {
  const count = haystack.split(needle).length - 1;
  if (count !== 1) {
    console.error(`[PATCH] ${label}: expected exactly 1 matching anchor, found ${count}.`);
    console.error('[PATCH] Your source may already contain this update or may be a different version.');
    process.exit(1);
  }
  return haystack.replace(needle, replacement);
}

if (src.includes(".setName('customerrolefix')") || src.includes('async function handleCustomerRoleFix(')) {
  console.log('[PATCH] /customerrolefix is already installed. Nothing to do.');
  process.exit(0);
}

const commandAnchor = "  new SlashCommandBuilder()\n    .setName('membercount')\n    .setDescription('Show the current server member count and customer totals.'),\n\n  new SlashCommandBuilder()\n    .setName('servergraph')";
const commandReplacement = "  new SlashCommandBuilder()\n    .setName('membercount')\n    .setDescription('Show the current server member count and customer totals.'),\n\n  new SlashCommandBuilder()\n    .setName('customerrolefix')\n    .setDescription('Move unverified Customers to the replacement role while protecting safe roles.')\n    .addBooleanOption(o => o\n      .setName('preview')\n      .setDescription('Only count who would be changed without changing any roles.'))\n    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),\n\n  new SlashCommandBuilder()\n    .setName('servergraph')";
src = replaceOnce(src, commandAnchor, commandReplacement, 'slash command registration');

const switchAnchor = "      case 'membercount': return handleMemberCount(interaction);\n      case 'servergraph': return handleServerGraph(interaction);";
const switchReplacement = "      case 'membercount': return handleMemberCount(interaction);\n      case 'customerrolefix': return handleCustomerRoleFix(interaction);\n      case 'servergraph': return handleServerGraph(interaction);";
src = replaceOnce(src, switchAnchor, switchReplacement, 'interaction command router');

const handlerAnchor = 'async function handleServerGraph(interaction) {';
const handler = "\nconst CUSTOMER_ROLE_FIX = Object.freeze({\n  sourceRoleId: '1537689864827445285',\n  destinationRoleId: '1542046269290315797',\n  protectedRequiredRoleId: '1537689864827445286',\n  safeRoleIds: new Set([\n    '1540199715470315530',\n    '1543902943009312870',\n    '1537689864827445287',\n  ]),\n});\n\nasync function handleCustomerRoleFix(interaction) {\n  const guild = interaction.guild;\n  if (!guild) return;\n\n  const preview = interaction.options.getBoolean('preview') ?? false;\n  await interaction.deferReply({ flags: MessageFlags.Ephemeral });\n\n  const actor = await guild.members.fetch(interaction.user.id).catch(() => interaction.member);\n  if (!actor?.permissions?.has(PermissionFlagsBits.Administrator)) {\n    return interaction.editReply(v2Edit({\n      title: 'Access Denied',\n      description: 'Administrator permission is required to run this command.',\n    }));\n  }\n\n  const [sourceRole, destinationRole, protectedRole, botMember] = await Promise.all([\n    guild.roles.fetch(CUSTOMER_ROLE_FIX.sourceRoleId).catch(() => null),\n    guild.roles.fetch(CUSTOMER_ROLE_FIX.destinationRoleId).catch(() => null),\n    guild.roles.fetch(CUSTOMER_ROLE_FIX.protectedRequiredRoleId).catch(() => null),\n    guild.members.fetchMe().catch(() => guild.members.me),\n  ]);\n\n  const missing = [];\n  if (!sourceRole) missing.push(CUSTOMER_ROLE_FIX.sourceRoleId);\n  if (!destinationRole) missing.push(CUSTOMER_ROLE_FIX.destinationRoleId);\n  if (!protectedRole) missing.push(CUSTOMER_ROLE_FIX.protectedRequiredRoleId);\n\n  for (const roleId of CUSTOMER_ROLE_FIX.safeRoleIds) {\n    const role = await guild.roles.fetch(roleId).catch(() => null);\n    if (!role) missing.push(roleId);\n  }\n\n  if (missing.length) {\n    return interaction.editReply(v2Edit({\n      title: 'Role Fix Stopped',\n      description: `I could not find these configured role IDs:\\n${missing.join('\\n')}`,\n    }));\n  }\n\n  if (!botMember?.permissions?.has(PermissionFlagsBits.ManageRoles)) {\n    return interaction.editReply(v2Edit({\n      title: 'Role Fix Stopped',\n      description: 'I need the **Manage Roles** permission before I can run this command.',\n    }));\n  }\n\n  const unmanageable = [sourceRole, destinationRole].filter(role =>\n    role.managed || role.position >= botMember.roles.highest.position\n  );\n\n  if (unmanageable.length) {\n    return interaction.editReply(v2Edit({\n      title: 'Role Fix Stopped',\n      description:\n        `My highest role must be above the roles I need to change.\\n\\n` +\n        unmanageable.map(role => `- ${role.name} (${role.id})`).join('\\n'),\n    }));\n  }\n\n  const members = await guild.members.fetch();\n\n  let changed = 0;\n  let wouldChange = 0;\n  let protectedByRequiredRole = 0;\n  let protectedBySafeRole = 0;\n  let failures = 0;\n  const failedUsers = [];\n\n  for (const member of members.values()) {\n    if (member.user.bot) continue;\n    if (!member.roles.cache.has(CUSTOMER_ROLE_FIX.sourceRoleId)) continue;\n\n    // This role protects the member completely.\n    if (member.roles.cache.has(CUSTOMER_ROLE_FIX.protectedRequiredRoleId)) {\n      protectedByRequiredRole++;\n      continue;\n    }\n\n    // Any one of these roles also protects the member completely.\n    if ([...CUSTOMER_ROLE_FIX.safeRoleIds].some(roleId => member.roles.cache.has(roleId))) {\n      protectedBySafeRole++;\n      continue;\n    }\n\n    wouldChange++;\n    if (preview) continue;\n\n    const alreadyHadDestination = member.roles.cache.has(CUSTOMER_ROLE_FIX.destinationRoleId);\n    let destinationAddedByThisRun = false;\n\n    try {\n      // Add first, remove second, so nobody is temporarily left with neither role.\n      if (!alreadyHadDestination) {\n        await member.roles.add(\n          CUSTOMER_ROLE_FIX.destinationRoleId,\n          `Customer role fix run by ${interaction.user.tag || interaction.user.username} (${interaction.user.id})`\n        );\n        destinationAddedByThisRun = true;\n      }\n\n      await member.roles.remove(\n        CUSTOMER_ROLE_FIX.sourceRoleId,\n        `Customer role fix run by ${interaction.user.tag || interaction.user.username} (${interaction.user.id})`\n      );\n\n      changed++;\n    } catch (error) {\n      failures++;\n      failedUsers.push(`${member.user.tag || member.user.username} (${member.id})`);\n\n      // Roll back the newly-added destination role when the old role could not be removed.\n      if (destinationAddedByThisRun && member.roles.cache.has(CUSTOMER_ROLE_FIX.sourceRoleId)) {\n        await member.roles.remove(\n          CUSTOMER_ROLE_FIX.destinationRoleId,\n          'Rolling back failed customer role fix'\n        ).catch(() => {});\n      }\n\n      console.error(`[ROLE FIX] Could not update ${member.user.tag || member.id}:`, error);\n    }\n  }\n\n  const summary =\n    `**${preview ? 'Would Change' : 'Changed'}**\\n${(preview ? wouldChange : changed).toLocaleString()}\\n\\n` +\n    `**Protected - Has ${CUSTOMER_ROLE_FIX.protectedRequiredRoleId}**\\n${protectedByRequiredRole.toLocaleString()}\\n\\n` +\n    `**Protected - Safe Roles**\\n${protectedBySafeRole.toLocaleString()}` +\n    `${preview ? '' : `\\n\\n**Failed**\\n${failures.toLocaleString()}`}` +\n    `${failedUsers.length ? `\\n\\n**Failed Members**\\n${failedUsers.slice(0, 15).join('\\n')}${failedUsers.length > 15 ? `\\n...and ${failedUsers.length - 15} more` : ''}` : ''}`;\n\n  if (!preview) {\n    await logAction({\n      title: 'Customer Role Fix Complete',\n      description:\n        `Changed **${changed}** member(s). Protected **${protectedByRequiredRole + protectedBySafeRole}** member(s). ` +\n        `${failures ? `Failed on **${failures}** member(s).` : 'No failures.'}`,\n      moderator: interaction.user,\n      extra:\n        `Removed role: ${CUSTOMER_ROLE_FIX.sourceRoleId}\\n` +\n        `Added role: ${CUSTOMER_ROLE_FIX.destinationRoleId}\\n` +\n        `Required-role protection: ${CUSTOMER_ROLE_FIX.protectedRequiredRoleId}\\n` +\n        `Safe roles: ${[...CUSTOMER_ROLE_FIX.safeRoleIds].join(', ')}`,\n    }).catch(() => {});\n  }\n\n  return interaction.editReply(v2Edit({\n    title: preview ? 'Customer Role Fix Preview' : 'Customer Role Fix Complete',\n    description: summary,\n  }));\n}\n\n";
src = replaceOnce(src, handlerAnchor, handler + handlerAnchor, 'role cleanup handler insertion');

fs.writeFileSync(INDEX_PATH, src, 'utf8');

if (fs.existsSync(PACKAGE_PATH)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
    pkg.version = '2.18.0';
    fs.writeFileSync(PACKAGE_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  } catch (error) {
    console.warn('[PATCH] Could not update package.json version:', error.message);
  }
}

console.log('');
console.log('[PATCH] Installed /customerrolefix successfully.');
console.log('[PATCH] Run: npm run check');
console.log('[PATCH] Then commit and push your changes.');
