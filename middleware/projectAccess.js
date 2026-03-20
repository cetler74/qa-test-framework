const { Project, ProjectMember, User } = require('../models');
const { Op } = require('sequelize');

/**
 * Get list of project IDs the user can access. Returns null for admin (meaning all).
 */
async function getAccessibleProjectIds(userId, isAdmin) {
  if (isAdmin) return null;
  const [publicAndOwned, shared] = await Promise.all([
    Project.findAll({
      where: { [Op.or]: [{ visibility: 'public' }, { owner_id: userId }] },
      attributes: ['id']
    }),
    ProjectMember.findAll({
      where: { user_id: userId },
      attributes: ['project_id']
    })
  ]);
  const ids = [...new Set([
    ...publicAndOwned.map(p => p.id),
    ...shared.map(s => s.project_id)
  ])];
  return ids;
}

/**
 * Check if user can access (read) a project.
 */
function canAccessProject(userId, isAdmin, project, memberUserIds) {
  if (isAdmin) return true;
  if (!project) return false;
  if (project.visibility === 'public') return true;
  if (project.owner_id === userId) return true;
  if (project.visibility === 'shared' && memberUserIds && memberUserIds.includes(userId)) return true;
  return false;
}

/**
 * Check if user can manage (write/delete) a project.
 */
function canManageProject(userId, isAdmin, project) {
  if (isAdmin) return true;
  if (!project) return false;
  return project.owner_id === userId;
}

/**
 * Load project by id with owner and members, then check access.
 * If requireManage is true, checks canManageProject; else canAccessProject.
 * On success calls next(); on failure sends 403/404 and does not call next.
 */
async function loadProjectAndCheckAccess(req, res, next, projectId, requireManage = false) {
  const userId = req.user.id;
  const isAdmin = req.user.is_admin;
  const id = parseInt(projectId, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid project id' });
  try {
    const project = await Project.findByPk(id, {
      include: [{ model: User, as: 'members', attributes: ['id'], through: { attributes: [] } }]
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const memberUserIds = (project.members || []).map(m => m.id);
    const canAccess = canAccessProject(userId, isAdmin, project, memberUserIds);
    const canManage = canManageProject(userId, isAdmin, project);
    if (requireManage && !canManage) return res.status(403).json({ error: 'Forbidden' });
    if (!requireManage && !canAccess) return res.status(403).json({ error: 'Forbidden' });
    req.project = project;
    req.projectMemberIds = memberUserIds;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * Check if user can access a project by id (loads project and members).
 * Returns Promise<boolean>.
 */
async function userCanAccessProjectId(userId, isAdmin, projectId) {
  if (isAdmin) return true;
  const project = await Project.findByPk(projectId, {
    include: [{ model: User, as: 'members', attributes: ['id'], through: { attributes: [] } }]
  });
  if (!project) return false;
  const memberUserIds = (project.members || []).map(m => m.id);
  return canAccessProject(userId, isAdmin, project, memberUserIds);
}

/**
 * Whether the user may edit project content: tests, catalogue, collections, runs, schedules, etc.
 * Matches read access — any member with access to the project can create/update/delete those resources.
 * (Project deletion and visibility are enforced separately via canManageProject + route logic.)
 */
async function userCanManageProjectId(userId, isAdmin, projectId) {
  return userCanAccessProjectId(userId, isAdmin, projectId);
}

module.exports = {
  getAccessibleProjectIds,
  canAccessProject,
  canManageProject,
  loadProjectAndCheckAccess,
  userCanAccessProjectId,
  userCanManageProjectId
};
