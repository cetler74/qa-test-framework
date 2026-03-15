/**
 * Convert Postman collection (JSON object) to OpenAPI 3.0 spec object.
 * Used by the CLI script (postman-to-swagger.js) and the web API (convert endpoint).
 */

const yaml = require('js-yaml');

function isRequest(item) {
  return item && typeof item.request === 'object';
}

function isFolder(item) {
  return item && Array.isArray(item.item);
}

/**
 * Recursively collect all requests from Postman items (handles nested folders).
 */
function collectRequests(items, prefix = '') {
  const requests = [];
  if (!Array.isArray(items)) return requests;

  for (const it of items) {
    if (isRequest(it)) {
      requests.push({ ...it, _folderPrefix: prefix });
    } else if (isFolder(it)) {
      const subPrefix = prefix ? `${prefix} / ${it.name}` : it.name;
      requests.push(...collectRequests(it.item, subPrefix));
    }
  }
  return requests;
}

/**
 * Build OpenAPI path string from Postman url object.
 * Replaces {{var}} in path segments with {var} for path params.
 */
function getPathFromUrl(url) {
  if (!url) return '/';
  const pathSegments = url.path || [];
  const pathStr = '/' + pathSegments
    .filter(Boolean)
    .map(seg => seg.replace(/\{\{([^}]+)\}\}/g, '{$1}'))
    .join('/');
  return pathStr || '/';
}

/**
 * Extract query parameters from Postman url.query.
 */
function getQueryParams(url) {
  const params = [];
  const query = url?.query;
  if (!Array.isArray(query)) return params;
  for (const q of query) {
    if (q && (q.key || q.value !== undefined)) {
      const key = q.key || q.value;
      if (!key) continue;
      params.push({
        name: key,
        in: 'query',
        required: q.disabled !== true,
        schema: { type: 'string' },
        description: q.description || undefined,
      });
    }
  }
  return params;
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return undefined;
  }
}

/**
 * Build OpenAPI operation from a Postman request.
 */
function requestToOperation(req, folderPrefix) {
  const reqObj = req.request || req;
  const method = (reqObj.method || 'GET').toLowerCase();
  const url = reqObj.url;
  const pathStr = getPathFromUrl(typeof url === 'string' ? { raw: url, path: url.split('?')[0].replace(/^\//, '').split('/') } : url);

  const summary = req.name || `${method} ${pathStr}`;
  const operationId = (folderPrefix + ' ' + req.name)
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .replace(/^_+/, '') || `${method}_${pathStr.replace(/\//g, '_').replace(/^_/, '')}`;

  const parameters = [...getQueryParams(typeof url === 'object' ? url : {})];

  const headers = reqObj.header || [];
  for (const h of headers) {
    const key = (h.key || '').trim();
    if (!key || /content-type/i.test(key)) continue;
    parameters.push({
      name: key,
      in: 'header',
      required: false,
      schema: { type: 'string' },
      description: h.description || undefined,
    });
  }

  let requestBody = undefined;
  const body = reqObj.body;
  if (body && (body.raw || body.mode === 'raw')) {
    const raw = body.raw;
    if (raw && typeof raw === 'string' && raw.trim()) {
      requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: { type: 'object', description: 'Request body (from Postman)' },
            example: safeJsonParse(raw),
          },
        },
      };
    }
  }

  const op = {
    summary,
    operationId: operationId || `${method}_path`,
    parameters: parameters.length ? parameters : undefined,
    requestBody,
    responses: {
      '200': { description: 'OK' },
      '400': { description: 'Bad Request' },
      '401': { description: 'Unauthorized' },
      '500': { description: 'Internal Server Error' },
    },
  };

  const hasBearer = (reqObj.header || []).some(h => /authorization/i.test(h.key || '') && /bearer/i.test((h.value || '')));
  if (hasBearer) {
    op.security = [{ BearerAuth: [] }];
  }

  return { method, pathStr, operation: op };
}

/**
 * Merge operations for the same path (different methods) into OpenAPI path item.
 */
function buildPaths(requests) {
  const pathMap = new Map();
  for (const req of requests) {
    const { method, pathStr, operation } = requestToOperation(req, req._folderPrefix || '');
    if (!pathMap.has(pathStr)) pathMap.set(pathStr, {});
    pathMap.get(pathStr)[method] = operation;
  }
  return Object.fromEntries(pathMap);
}

/**
 * Build OpenAPI 3.0 spec object from Postman collection object.
 * @param {object} collection - Parsed Postman collection (v2.0 or v2.1)
 * @returns {object} OpenAPI 3.0 spec object
 */
function postmanToOpenApi(collection) {
  const info = collection.info || {};
  const requests = collectRequests(collection.item || []);
  const paths = buildPaths(requests);

  const variables = (collection.variable || []).reduce((acc, v) => {
    acc[v.key] = v.value;
    return acc;
  }, {});

  const baseUrl = variables.base_url || variables.baseUrl || variables.base || 'https://api.example.com';
  const servers = [{ url: baseUrl.replace(/\/$/, ''), description: 'From Postman base_url' }];

  const hasBearer = requests.some(r => {
    const headers = (r.request || r).header || [];
    return headers.some(h => /authorization/i.test(h.key || '') && /bearer/i.test((h.value || '')));
  });

  const spec = {
    openapi: '3.0.0',
    info: {
      title: info.name || 'API',
      description: info.description || 'Converted from Postman collection',
      version: info.schema ? '1.0.0' : (info.version || '1.0.0'),
    },
    servers,
    paths,
    components: {
      securitySchemes: hasBearer
        ? { BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Bearer token' } }
        : undefined,
    },
  };

  if (hasBearer) {
    spec.security = [{ BearerAuth: [] }];
  }

  return spec;
}

/**
 * Convert Postman collection to OpenAPI 3.0 YAML string.
 * @param {object} collection - Parsed Postman collection
 * @returns {string} YAML string
 */
function postmanToOpenApiYaml(collection) {
  const spec = postmanToOpenApi(collection);
  return yaml.dump(spec, { lineWidth: 120, noRefs: true });
}

module.exports = {
  postmanToOpenApi,
  postmanToOpenApiYaml,
};
