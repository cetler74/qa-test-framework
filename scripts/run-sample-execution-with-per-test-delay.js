const { Collection, Project } = require('../models');
const { executeTests } = require('../services/testRunner');

async function runSample() {
  try {
    // Ensure project exists
    let project = await Project.findOne();
    if (!project) {
      project = await Project.create({ name: 'Per-Test Delay Project' });
    }

    // Build a minimal Postman collection with two requests to the local server
    const collectionJson = {
      info: { name: 'Per-Test Delay Collection', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [
        {
          name: 'GET Root',
          request: {
            method: 'GET',
            url: 'http://localhost:3000/'
          }
        },
        {
          name: 'GET Missing',
          request: {
            method: 'GET',
            url: 'http://localhost:3000/missing'
          }
        }
      ]
    };

    // Create collection record
    const collection = await Collection.create({ name: 'Per-Test Delay Collection', collection_json: collectionJson });

    console.log('Created temporary collection with id:', collection.id);

    // Execute tests with per-test delays: wait 3 seconds after the first test (path '0')
    const testDelays = {};
    testDelays[collection.id] = { '0': 3 }; // path '0' corresponds to the first item in the collection

    const start = Date.now();
    const results = await executeTests(project.id, 'Per-Test Delay Run', { collectionIds: [collection.id], testDelays: testDelays });
    const end = Date.now();

    console.log('Execution summary:', results.summary);
    console.log('Measured wall time (ms):', end - start);

    // Clean up collection
    await collection.destroy();

    process.exit(0);
  } catch (err) {
    console.error('Error during sample execution:', err);
    process.exit(1);
  }
}

runSample();