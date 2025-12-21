const yaml = require('js-yaml');
const fs = require('fs');

/**
 * Convert OpenAPI YAML/JSON specification to Postman Collection
 * @param {string|object} specContent - OpenAPI spec as string (YAML/JSON) or parsed object
 * @param {string} format - 'yaml' or 'json'
 * @param {string} name - Collection name
 * @returns {Promise<object>} Postman Collection v2.1
 */
async function convertToPostmanCollection(specContent, format, name = 'API Collection') {
  try {
    let openApiSpec;

    // Parse the spec based on format
    if (typeof specContent === 'string') {
      if (format === 'yaml' || format === 'yml') {
        openApiSpec = yaml.load(specContent);
      } else {
        openApiSpec = JSON.parse(specContent);
      }
    } else {
      openApiSpec = specContent;
    }

    // Validate OpenAPI version
    if (!openApiSpec.openapi && !openApiSpec.swagger) {
      throw new Error('Invalid OpenAPI specification: missing openapi/swagger field');
    }

    // Build Postman Collection from OpenAPI spec
    const collection = {
      info: {
        name: name,
        description: openApiSpec.info?.description || '',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        _postman_id: generateId()
      },
      item: []
    };

    // Convert paths to Postman items
    const paths = openApiSpec.paths || {};
    // Get base URL from servers section (required in OpenAPI spec)
    let baseUrl = '';
    if (openApiSpec.servers && openApiSpec.servers.length > 0) {
      baseUrl = openApiSpec.servers[0].url;
      // Remove trailing slash if present
      baseUrl = baseUrl.replace(/\/$/, '');
    }
    
    // Add base URL as collection variable for easy modification
    if (baseUrl) {
      if (!collection.variable) {
        collection.variable = [];
      }
      // Check if base_url variable already exists
      const existingVar = collection.variable.find(v => v.key === 'base_url');
      if (!existingVar) {
        collection.variable.push({
          key: 'base_url',
          value: baseUrl,
          type: 'string'
        });
      } else {
        existingVar.value = baseUrl;
      }
    }

    for (const [path, pathItem] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method.toLowerCase())) {
          const item = createPostmanItem(operation, method.toUpperCase(), path, baseUrl, openApiSpec);
          collection.item.push(item);
        }
      }
    }

    // Set authentication if Bearer token is defined
    if (openApiSpec.components?.securitySchemes?.BearerAuth || 
        openApiSpec.securityDefinitions?.BearerAuth) {
      collection.auth = {
        type: 'bearer',
        bearer: [
          {
            key: 'token',
            value: '{{bearer_token}}',
            type: 'string'
          }
        ]
      };
      
      // Add bearer_token as a collection variable (empty by default, user must set it)
      if (!collection.variable) {
        collection.variable = [];
      }
      const existingBearerToken = collection.variable.find(v => v.key === 'bearer_token');
      if (!existingBearerToken) {
        collection.variable.push({
          key: 'bearer_token',
          value: '', // Empty by default - must be set via environment or manually
          type: 'string'
        });
      }
    }

    return collection;
  } catch (error) {
    throw new Error(`Failed to convert API spec to Postman collection: ${error.message}`);
  }
}

/**
 * Create a Postman item from OpenAPI operation
 */
function createPostmanItem(operation, method, path, baseUrl, openApiSpec) {
  // Convert OpenAPI path parameters {param} to Postman format :param
  const postmanPath = path.replace(/{([^}]+)}/g, ':$1');
  
  // Construct full URL - use base_url variable if baseUrl is set, otherwise use direct URL
  let fullUrl;
  if (baseUrl) {
    // Use Postman variable for base URL so it can be easily changed
    fullUrl = `{{base_url}}${postmanPath}`;
  } else {
    // Fallback: use path only (will need to be configured manually)
    fullUrl = postmanPath;
  }
  
  const url = parseUrl(fullUrl, baseUrl);

  const item = {
    name: operation.summary || operation.operationId || `${method} ${path}`,
    request: {
      method: method,
      header: [],
      url: url,
      description: operation.description || ''
    },
    response: []
  };

  // Add parameters
  if (operation.parameters) {
    operation.parameters.forEach(param => {
      if (param.in === 'header') {
        item.request.header.push({
          key: param.name,
          value: param.schema?.default || '',
          type: 'text'
        });
      } else if (param.in === 'query') {
        if (!url.query) url.query = [];
        url.query.push({
          key: param.name,
          value: param.schema?.default || '',
          type: 'text'
        });
      } else if (param.in === 'path') {
        // Path parameters are already in the URL
      }
    });
  }

  // Add request body
  if (operation.requestBody) {
    const content = operation.requestBody.content || {};
    const jsonContent = content['application/json'];
    if (jsonContent) {
      item.request.body = {
        mode: 'raw',
        raw: JSON.stringify(generateExampleFromSchema(jsonContent.schema, openApiSpec), null, 2),
        options: {
          raw: {
            language: 'json'
          }
        }
      };
      item.request.header.push({
        key: 'Content-Type',
        value: 'application/json',
        type: 'text'
      });
    }
  }

  return item;
}

/**
 * Parse URL into Postman URL format
 */
function parseUrl(urlString, baseUrl = '') {
  try {
    // Handle Postman variables like {{base_url}}
    if (urlString.includes('{{base_url}}')) {
      // Extract path from URL string
      const pathPart = urlString.replace('{{base_url}}', '');
      const pathSegments = pathPart.split('/').filter(p => p && p !== '');
      
      // If we have a baseUrl, parse it to get protocol and host structure
      if (baseUrl) {
        try {
          const baseUrlObj = new URL(baseUrl);
          return {
            raw: urlString,
            protocol: baseUrlObj.protocol.replace(':', ''),
            host: ['{{base_url}}'], // Use variable for host
            path: pathSegments,
            variable: []
          };
        } catch (e) {
          // Base URL parsing failed, use simple format
        }
      }
      
      // Simple format with variable
      return {
        raw: urlString,
        host: ['{{base_url}}'],
        path: pathSegments,
        variable: []
      };
    }
    
    // Try to parse as full URL
    const url = new URL(urlString);
    const urlObj = {
      raw: urlString,
      protocol: url.protocol.replace(':', ''),
      host: url.hostname.split('.'),
      path: url.pathname.split('/').filter(p => p)
    };

    // Extract path variables (Postman format :variable)
    urlObj.variable = [];
    urlObj.path.forEach((segment) => {
      if (segment.startsWith(':')) {
        urlObj.variable.push({
          key: segment.substring(1),
          value: '',
          type: 'string'
        });
      }
    });

    if (url.search) {
      urlObj.query = [];
      url.searchParams.forEach((value, key) => {
        urlObj.query.push({
          key: key,
          value: value,
          type: 'text'
        });
      });
    }

    return urlObj;
  } catch (error) {
    // Fallback: treat as path-only URL
    const pathSegments = urlString.split('/').filter(p => p && p !== '');
    
    return {
      raw: urlString,
      path: pathSegments.length > 0 ? pathSegments : [urlString],
      variable: [],
      host: baseUrl ? ['{{base_url}}'] : []
    };
  }
}

/**
 * Generate example from JSON schema
 */
function generateExampleFromSchema(schema, openApiSpec) {
  if (!schema) return {};

  if (schema.type === 'object') {
    const example = {};
    if (schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        example[key] = generateExampleFromSchema(prop, openApiSpec);
      }
    }
    return example;
  } else if (schema.type === 'array') {
    return [generateExampleFromSchema(schema.items, openApiSpec)];
  } else if (schema.type === 'string') {
    return schema.example || schema.default || 'string';
  } else if (schema.type === 'number' || schema.type === 'integer') {
    return schema.example || schema.default || 0;
  } else if (schema.type === 'boolean') {
    return schema.example || schema.default || false;
  } else if (schema.$ref) {
    const refPath = schema.$ref.replace('#/components/schemas/', '');
    const refSchema = openApiSpec.components?.schemas?.[refPath];
    if (refSchema) {
      return generateExampleFromSchema(refSchema, openApiSpec);
    }
  }

  return {};
}

/**
 * Generate a random ID for Postman collection
 */
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Convert Postman Collection JSON directly (no conversion needed)
 * @param {string|object} collectionContent - Postman collection as string or object
 * @returns {object} Postman Collection
 */
function parsePostmanCollection(collectionContent) {
  try {
    let collection;
    if (typeof collectionContent === 'string') {
      collection = JSON.parse(collectionContent);
    } else {
      collection = collectionContent;
    }

    // Validate it's a Postman collection
    if (!collection.info && !collection.item) {
      throw new Error('Invalid Postman collection format');
    }

    return collection;
  } catch (error) {
    throw new Error(`Failed to parse Postman collection: ${error.message}`);
  }
}

module.exports = {
  convertToPostmanCollection,
  parsePostmanCollection
};

