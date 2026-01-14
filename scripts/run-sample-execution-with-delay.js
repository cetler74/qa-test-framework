const { Collection, Project } = require('../models');
const { executeTests } = require('../services/testRunner');

async function runSample() {
  try {
    // Ensure project exists
    let project = await Project.findOne();
    if (!project) {
      project = await Project.create({ name: 'Delay Test Project' });
    }

    // Build a minimal Postman collection with two requests to the local server
    const collectionJson = {
      info: { name: 'Delay Sample Collection', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
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
    const collection = await Collection.create({ name: 'Delay Sample Collection', collection_json: collectionJson });

    console.log('Created temporary collection with id:', collection.id);

    // Execute tests with a 2-second global delay between tests
    const start = Date.now();
    const results = await executeTests(project.id, 'Delay Execution Run', { collectionIds: [collection.id], delayBetweenTests: 2 });
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
