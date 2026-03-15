#!/usr/bin/env node

/**
 * Backfill script for project_tests and project_test_stats.
 *
 * - For each project:
 *   - Sync the catalogue from API specs, SOAP operations, and UI tests.
 *   - For each catalogue entry, look at existing run/result tables and
 *     approximate total_runs, last_status, and last_run_at based on history.
 *
 * This script is safe to run multiple times; it will upsert stats.
 */

const path = require('path');
const { sequelize, Project, TestRun, TestResult, PlaywrightRun, PlaywrightResult, ProjectTest, ProjectTestStat } = require('../models');
const { syncProjectTests } = require('../services/testCatalogue');

async function backfillForProject(project) {
  console.log(`\n[backfill] Processing project ${project.id} – ${project.name}`);

  // Ensure catalogue exists and is in sync for this project
  await syncProjectTests(project.id);

  const projectTests = await ProjectTest.findAll({
    where: { project_id: project.id }
  });

  let updatedCount = 0;

  for (const pt of projectTests) {
    let totalRuns = 0;
    let lastStatus = 'not_run';
    let lastRunAt = null;
    let lastRunSource = null;
    let lastRunType = null;
    let lastRunId = null;

    if (pt.test_type === 'api') {
      // Stable key: api:<method>:<name>
      const [_, method, name] = (pt.stable_key || '').split(':');
      if (method && name) {
        const results = await TestResult.findAll({
          where: {
            project_id: undefined, // project_id not on TestResult; join via TestRun
          },
          limit: 0
        }).catch(() => []);

        // We cannot query by project_id directly on TestResult, so use a raw query joining test_runs
        const rows = await sequelize.query(
          `
          SELECT tr.id as test_run_id, tr.project_id, tr.created_at, r.status
          FROM test_results r
          JOIN test_runs tr ON tr.id = r.test_run_id
          WHERE tr.project_id = :projectId
            AND r.method = :method
            AND r.test_name = :name
          ORDER BY tr.created_at DESC
          `,
          {
            replacements: { projectId: project.id, method, name },
            type: sequelize.QueryTypes.SELECT
          }
        );

        totalRuns = rows.length;
        if (rows.length > 0) {
          const latest = rows[0];
          lastRunAt = latest.created_at;
          lastRunId = latest.test_run_id;
          lastRunSource = 'api';
          lastRunType = 'api';
          lastStatus = latest.status || 'not_run';
        }
      }
    } else if (pt.test_type === 'soap') {
      // Stable key: soap:<operation_name>:<name>
      const parts = (pt.stable_key || '').split(':');
      const opName = parts[1];
      const name = parts[2];
      if (opName && name) {
        const rows = await sequelize.query(
          `
          SELECT tr.id as test_run_id, tr.project_id, tr.created_at, r.status
          FROM test_results r
          JOIN test_runs tr ON tr.id = r.test_run_id
          WHERE tr.project_id = :projectId
            AND tr.run_type = 'soap'
            AND r.method = 'SOAP'
            AND r.endpoint = :opName
            AND r.test_name = :name
          ORDER BY tr.created_at DESC
          `,
          {
            replacements: { projectId: project.id, opName, name },
            type: sequelize.QueryTypes.SELECT
          }
        );
        totalRuns = rows.length;
        if (rows.length > 0) {
          const latest = rows[0];
          lastRunAt = latest.created_at;
          lastRunId = latest.test_run_id;
          lastRunSource = 'soap';
          lastRunType = 'soap';
          lastStatus = latest.status || 'not_run';
        }
      }
    } else if (pt.test_type === 'ui_builtin' || pt.test_type === 'ui_recorded') {
      // For UI tests, approximate using PlaywrightResult rows by test_name.
      const name = pt.name;
      if (name) {
        const rows = await sequelize.query(
          `
          SELECT pr.id as playwright_run_id, pr.project_id, pr.created_at, r.status
          FROM playwright_results r
          JOIN playwright_runs pr ON pr.id = r.playwright_run_id
          WHERE pr.project_id = :projectId
            AND r.test_name = :name
          ORDER BY pr.created_at DESC
          `,
          {
            replacements: { projectId: project.id, name },
            type: sequelize.QueryTypes.SELECT
          }
        );
        totalRuns = rows.length;
        if (rows.length > 0) {
          const latest = rows[0];
          lastRunAt = latest.created_at;
          lastRunId = latest.playwright_run_id;
          lastRunSource = 'ui_run';
          lastRunType = 'ui';
          lastStatus = latest.status || 'not_run';
        }
      }
    }

    const [stats] = await ProjectTestStat.findOrCreate({
      where: { project_test_id: pt.id },
      defaults: {
        total_runs: totalRuns,
        last_status: lastStatus,
        last_run_at: lastRunAt,
        last_run_source: lastRunSource,
        last_run_type: lastRunType,
        last_run_id: lastRunId
      }
    });

    // Update if we found any history
    if (totalRuns > 0) {
      await stats.update({
        total_runs: totalRuns,
        last_status: lastStatus,
        last_run_at: lastRunAt,
        last_run_source: lastRunSource,
        last_run_type: lastRunType,
        last_run_id: lastRunId
      });
      updatedCount++;
    }
  }

  console.log(`[backfill] Updated stats for ${updatedCount} tests in project ${project.id}`);
}

async function main() {
  try {
    console.log('[backfill] Starting backfill for project_tests and project_test_stats…');
    await sequelize.authenticate();
    const projects = await Project.findAll();
    for (const project of projects) {
      await backfillForProject(project);
    }
    console.log('\n[backfill] Done.');
    process.exit(0);
  } catch (err) {
    console.error('[backfill] Error:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

