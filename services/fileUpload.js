const multer = require('multer');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

// Ensure upload directory exists
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `api-spec-${uniqueSuffix}${ext}`);
  }
});

// File filter for YAML/JSON/WSDL files
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (['.yaml', '.yml', '.json', '.wsdl', '.xml'].includes(ext)) {
    cb(null, true);
  } else {
    const error = new Error('Only YAML, JSON, and WSDL files are allowed');
    req.fileValidationError = error.message;
    cb(error, false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 // 10MB default
  }
});

/**
 * Validate and parse API specification file
 * @param {string} filePath - Path to the uploaded file
 * @param {string} format - 'yaml' or 'json'
 * @returns {object} Parsed API specification
 */
function validateAndParseApiSpec(filePath, format) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    let spec;

    if (format === 'yaml' || format === 'yml') {
      spec = yaml.load(content);
    } else {
      spec = JSON.parse(content);
    }

    // Validate OpenAPI structure
    if (!spec.openapi && !spec.swagger) {
      throw new Error('Invalid OpenAPI specification: missing openapi/swagger field');
    }

    // Check for required OpenAPI fields
    if (!spec.info || !spec.info.title) {
      throw new Error('Invalid OpenAPI specification: missing info.title');
    }

    return {
      spec,
      content
    };
  } catch (error) {
    throw new Error(`Failed to validate API specification: ${error.message}`);
  }
}

/**
 * Validate Postman Collection JSON
 * @param {string} filePath - Path to the uploaded file
 * @returns {object} Parsed Postman collection
 */
function validatePostmanCollection(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const collection = JSON.parse(content);

    // Validate Postman collection structure
    if (!collection.info) {
      throw new Error('Invalid Postman collection: missing "info" field');
    }
    
    // item should exist and be an array (can be empty)
    if (collection.item === undefined) {
      throw new Error('Invalid Postman collection: missing "item" field');
    }
    
    if (!Array.isArray(collection.item)) {
      throw new Error('Invalid Postman collection: "item" must be an array');
    }

    // Validate schema if present
    if (collection.info.schema && !collection.info.schema.includes('postman.com/json/collection')) {
      console.warn('Warning: Collection schema may not be a valid Postman collection schema');
    }

    return {
      collection,
      content
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON file: ${error.message}`);
    }
    throw new Error(`Failed to validate Postman collection: ${error.message}`);
  }
}

/**
 * Parse WSDL file and return list of operations { name, operation_name }
 * @param {string} filePath - Path to WSDL file
 * @returns {Promise<Array<{ name: string, operation_name: string }>>}
 */
function parseWSDLToOperations(filePath) {
  return new Promise((resolve, reject) => {
    const soap = require('soap');
    const url = path.resolve(filePath);
    soap.createClient(url, (err, client) => {
      if (err) {
        return reject(new Error(`Invalid WSDL: ${err.message}`));
      }
      const desc = client.describe();
      const operations = [];
      for (const serviceName of Object.keys(desc || {})) {
        const service = desc[serviceName];
        for (const portName of Object.keys(service || {})) {
          const port = service[portName];
          for (const opName of Object.keys(port || {})) {
            if (opName && typeof port[opName] === 'object') {
              operations.push({ name: opName, operation_name: opName });
            }
          }
        }
      }
      resolve(operations);
    });
  });
}

module.exports = {
  upload,
  validateAndParseApiSpec,
  validatePostmanCollection,
  parseWSDLToOperations
};

