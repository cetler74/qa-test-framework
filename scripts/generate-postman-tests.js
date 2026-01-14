const fs = require('fs');
const path = require('path');

const inputFile = path.resolve(__dirname, '..', 'SmartAPI-CAMARA R2.0.0.postman_collection_v2.json');
const outputFile = path.resolve(__dirname, '..', 'SmartAPI-CAMARA R2.0.0.tests.postman_collection.json');

function safeParseJson(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

function inferType(val) {
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  return typeof val;
}

function quote(s) { return JSON.stringify(s); }

function buildTestScriptFromExample(example) {
  const expectedCode = example.code;
  // try parse example.body to infer expected fields (if JSON)
  let bodyObj = null;
  if (example.body) {
    bodyObj = safeParseJson(example.body);
  }

  const lines = [];
  lines.push(`// Auto-generated test from example: ${example.name}`);
  lines.push(`pm.test('Status code is ${expectedCode}', function () {`);
  lines.push(`    pm.expect(pm.response.code).to.eql(${expectedCode});`);
  lines.push('});');

  lines.push("pm.test('Content-Type header is application/json', function () {");
  lines.push("    pm.response.to.have.header('Content-Type');");
  lines.push("    pm.expect(pm.response.headers.get('Content-Type')).to.include('application/json');");
  lines.push('});');

  lines.push('let jsonData = null;');
  lines.push('try { jsonData = pm.response.json(); } catch (e) { /* not JSON or empty */ }');

  if (bodyObj && typeof bodyObj === 'object') {
    Object.keys(bodyObj).forEach((k) => {
      const t = inferType(bodyObj[k]);
      lines.push(`pm.test('Response has property ${k}', function () {`);
      lines.push(`    pm.expect(jsonData).to.have.property('${k}');`);
      lines.push('});');
      if (t === 'string' || t === 'number' || t === 'boolean' || t === 'null') {
        lines.push(`pm.test('Property ${k} type is ${t}', function () {`);
        if (t === 'null') {
          lines.push(`    pm.expect(jsonData['${k}']).to.eql(null);`);
        } else {
          lines.push(`    pm.expect(typeof jsonData['${k}']).to.eql('${t}');`);
        }
        lines.push('});');
      } else if (t === 'object') {
        lines.push(`pm.test('Property ${k} is an object', function () {`);
        lines.push(`    pm.expect(jsonData['${k}']).to.be.an('object');`);
        lines.push('});');
      } else if (t === 'array') {
        lines.push(`pm.test('Property ${k} is an array', function () {`);
        lines.push(`    pm.expect(jsonData['${k}']).to.be.an('array');`);
        lines.push('});');
      }
    });
  } else {
    lines.push("// No example JSON body to infer fields from (or body is not JSON)");
  }

  return lines.join('\n');
}

function processItems(items, parentFolders, outputItems) {
  items.forEach(item => {
    if (item.item && Array.isArray(item.item)) {
      // folder
      processItems(item.item, parentFolders.concat(item.name), outputItems);
    } else {
      // request item
      const baseName = parentFolders.concat(item.name).join(' / ');
      const requestTemplate = item.request || (item.items && item.items[0] && item.items[0].request) || null;

      if (!requestTemplate) return; // nothing to do

      const responses = item.response || [];
      if (responses.length === 0) {
        // create a single test entry using the request (no example responses)
        const newItem = {
          name: `${baseName} - (no example)`,
          request: requestTemplate,
          event: [{ listen: 'test', script: { exec: ["pm.test('Request executed (no example provided)', function(){pm.expect(pm.response.code).to.be.oneOf([200,400,401,403,404,422,429]);});"], type: 'text/javascript' } }]
        };
        outputItems.push(newItem);
      } else {
        responses.forEach(example => {
          // prefer example.originalRequest but start with a deep copy so we can safely modify headers
          let exampleRequest = (example.originalRequest && JSON.parse(JSON.stringify(example.originalRequest))) || JSON.parse(JSON.stringify(requestTemplate));

          // Merge missing important headers from requestTemplate (e.g., Authorization) when not present in the example originalRequest
          if (requestTemplate && requestTemplate.header) {
            exampleRequest.header = exampleRequest.header || [];
            const hasAuth = exampleRequest.header.some(h => h.key && h.key.toLowerCase() === 'authorization');
            if (!hasAuth) {
              const tmplAuth = requestTemplate.header.find(h => h.key && h.key.toLowerCase() === 'authorization');
              if (tmplAuth) exampleRequest.header.push(tmplAuth);
            }
          }

          const newReq = exampleRequest;
          // normalize url to use existing variables (leave as-is)

          const newItem = {
            name: `${baseName} - ${example.name}`,
            request: newReq,
            response: [example],
            event: [{ listen: 'test', script: { exec: [ buildTestScriptFromExample(example) ], type: 'text/javascript' } }]
          };
          outputItems.push(newItem);
        });
      }
    }
  });
}

function main() {
  const raw = fs.readFileSync(inputFile, 'utf8');
  const coll = JSON.parse(raw);

  const out = {
    info: Object.assign({}, coll.info, { name: coll.info.name + ' - Tests' }),
    item: []
  };

  processItems(coll.item, [], out.item);

  fs.writeFileSync(outputFile, JSON.stringify(out, null, 2), 'utf8');
  console.log('Generated test collection at', outputFile);
}

main();
