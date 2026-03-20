#!/usr/bin/env node
/**
 * Convert a Postman collection (JSON) to OpenAPI 3.0 (Swagger) YAML.
 *
 * Usage:
 *   node scripts/postman-to-swagger.js <path-to-collection.json> [output.yaml]
 *
 * If output is omitted, writes to stdout or a default file next to the collection.
 */

const fs = require('fs');
const path = require('path');
const { postmanToOpenApiYaml } = require('../services/postmanToOpenApi');

function loadPostmanCollection(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Usage: node scripts/postman-to-swagger.js <postman-collection.json> [output.yaml]');
    process.exit(1);
  }

  const inputPath = path.resolve(args[0]);
  const outputPath = args[1] ? path.resolve(args[1]) : inputPath.replace(/\.json$/i, '.openapi.yaml');

  if (!fs.existsSync(inputPath)) {
    console.error('File not found:', inputPath);
    process.exit(1);
  }

  const collection = loadPostmanCollection(inputPath);
  const yamlStr = postmanToOpenApiYaml(collection);

  fs.writeFileSync(outputPath, yamlStr, 'utf8');
  console.log('Written:', outputPath);
}

main();
