# Variables and Environment Management

## Overview

The QA Testing Tool supports Postman variables in multiple ways:
1. **Collection Variables** - Automatically extracted from OpenAPI specs
2. **Environment Variables** - Can be configured per project or test run
3. **Custom Variables** - Can be added manually to collections

## How Variables Work

### 1. Collection Variables (Automatic)

When you upload an OpenAPI specification:

- **Base URL**: Automatically extracted from the `servers` section and stored as `base_url` collection variable
- **Bearer Token**: If Bearer auth is defined, `{{bearer_token}}` variable is added (value needs to be set)
- **Other Variables**: Any variables in the OpenAPI spec are preserved

**Example OpenAPI:**
```yaml
servers:
  - url: https://api.example.com
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
```

**Resulting Collection Variables:**
```json
{
  "variable": [
    {
      "key": "base_url",
      "value": "https://api.example.com",
      "type": "string"
    }
  ],
  "auth": {
    "type": "bearer",
    "bearer": [
      {
        "key": "token",
        "value": "{{bearer_token}}",
        "type": "string"
      }
    ]
  }
}
```

### 2. Environment Variables (Manual Configuration)

Environment variables can be set in two ways:

#### Option A: Via API Request (Recommended for UI)

When executing tests, you can pass environment variables:

```javascript
POST /api/test-runs/execute
{
  "projectId": 1,
  "collectionIds": [1, 2],
  "name": "Test Run",
  "envVars": {
    "bearer_token": "your-token-here",
    "api_key": "your-api-key",
    "environment": "production"
  }
}
```

#### Option B: Via Postman Environment File

1. Create a Postman environment file (JSON format)
2. Upload it or reference it when running tests
3. Newman will use the environment file

**Example Environment File:**
```json
{
  "id": "env-id",
  "name": "Production",
  "values": [
    {
      "key": "bearer_token",
      "value": "your-token",
      "type": "string",
      "enabled": true
    },
    {
      "key": "api_key",
      "value": "your-api-key",
      "type": "string",
      "enabled": true
    }
  ]
}
```

### 3. Variable Precedence

When multiple variable sources exist, Newman resolves them in this order:
1. **Environment Variables** (highest priority)
2. **Collection Variables**
3. **Global Variables** (if any)

## Current Implementation

### What Works Automatically

✅ **Base URL**: Extracted from OpenAPI `servers` section  
✅ **Collection Variables**: Preserved from OpenAPI specs  
✅ **Variable Merging**: When merging collections, variables are combined (first occurrence wins)  
✅ **Environment Support**: Can pass environment variables via API

### What Needs Manual Configuration

⚠️ **Bearer Token**: Variable `{{bearer_token}}` is created but value must be set  
⚠️ **Custom Variables**: Need to be added via environment or collection editing  
⚠️ **Environment Files**: Need to be created and referenced manually

## Variable Resolution in Newman

Newman resolves variables in this order:

1. **Environment Variables** (from `-e` flag or `envVar` option)
2. **Collection Variables** (from `collection.variable` array)
3. **Global Variables** (if defined)

Example:
```javascript
// Collection has: base_url = "https://api.example.com"
// Environment has: base_url = "https://staging.example.com"
// Result: Uses "https://staging.example.com" (environment wins)
```

## Best Practices

### 1. Use Collection Variables for Defaults

Store default values in collection variables:
- Base URLs
- Default headers
- Common parameters

### 2. Use Environment Variables for Secrets

Store sensitive values in environment variables:
- API keys
- Bearer tokens
- Passwords

### 3. Use Different Environments for Different Stages

Create separate environments for:
- Development
- Staging
- Production

### 4. Variable Naming

Use clear, consistent names:
- `base_url` - Base API URL
- `bearer_token` - Authentication token
- `api_key` - API key
- `environment` - Environment name (dev/staging/prod)

## Future Enhancements

Planned improvements:
- [ ] UI for managing environment variables per project
- [ ] Environment file upload and management
- [ ] Variable templates for common configurations
- [ ] Secure storage for sensitive variables
- [ ] Variable validation and type checking

## Examples

### Setting Bearer Token via API

```javascript
// When running tests
const response = await fetch('/api/test-runs/execute', {
  method: 'POST',
  body: JSON.stringify({
    projectId: 1,
    collectionIds: [1],
    name: 'Production Tests',
    envVars: {
      bearer_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
    }
  })
});
```

### Multiple Environments

```javascript
// Development
envVars: {
  base_url: 'https://dev-api.example.com',
  bearer_token: 'dev-token'
}

// Production
envVars: {
  base_url: 'https://api.example.com',
  bearer_token: 'prod-token'
}
```

### Overriding Collection Variables

```javascript
// Collection has base_url = "https://api.example.com"
// Override for staging
envVars: {
  base_url: 'https://staging-api.example.com'
}
```

