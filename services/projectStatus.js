const { Project } = require('../models');

const PROJECT_STATUS = Object.freeze({
  ONGOING: 'ongoing',
  CLOSED: 'closed'
});

const PROJECT_STATUS_VALUES = Object.freeze(Object.values(PROJECT_STATUS));

function normalizeProjectStatus(value) {
  if (value === undefined || value === null || value === '') {
    return PROJECT_STATUS.ONGOING;
  }

  const normalized = String(value).trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'ongoing') return PROJECT_STATUS.ONGOING;
  if (normalized === 'closed') return PROJECT_STATUS.CLOSED;
  return null;
}

function getProjectStatusLabel(value) {
  const normalized = normalizeProjectStatus(value);
  return normalized === PROJECT_STATUS.CLOSED ? 'Closed' : 'On going';
}

class ProjectClosedError extends Error {
  constructor(project) {
    const label = project && project.name ? `Project "${project.name}"` : 'Project';
    super(`${label} is closed. New test runs are disabled.`);
    this.name = 'ProjectClosedError';
    this.projectId = project && project.id ? project.id : null;
    this.projectStatus = PROJECT_STATUS.CLOSED;
  }
}

async function ensureProjectIsRunnable(projectId, options = {}) {
  const attributes = options.attributes || ['id', 'name', 'status'];
  const project = await Project.findByPk(projectId, { attributes });
  if (!project) {
    const error = new Error('Project not found');
    error.name = 'ProjectNotFoundError';
    throw error;
  }

  const normalized = normalizeProjectStatus(project.status);
  if (normalized === PROJECT_STATUS.CLOSED) {
    throw new ProjectClosedError(project);
  }

  return project;
}

module.exports = {
  PROJECT_STATUS,
  PROJECT_STATUS_VALUES,
  ProjectClosedError,
  ensureProjectIsRunnable,
  getProjectStatusLabel,
  normalizeProjectStatus
};