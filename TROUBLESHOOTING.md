# Troubleshooting Test Failures

## Common Issues and Solutions

### 1. Tests Failing with "Connection Failed" or Timeout

**Symptoms:**
- All tests fail immediately
- Error message: "Connection failed or timeout"
- Response code is 0

**Possible Causes:**
- API server is not running or not accessible
- Base URL is incorrect or missing
- Network/firewall blocking requests

**Solutions:**
1. **Check Base URL in OpenAPI Spec:**
   - Ensure your OpenAPI YAML/JSON has a `servers` section with the correct base URL
   - Example:
     ```yaml
     servers:
       - url: https://api.example.com
     ```

2. **Set Environment Variable:**
   - Add to your `.env` file:
     ```
     API_BASE_URL=https://your-api-url.com
     ```

3. **Verify API is Accessible:**
   - Test the API manually using curl or Postman
   - Check if the server is running
   - Verify network connectivity

### 2. Tests Failing with HTTP 401 (Unauthorized)

**Symptoms:**
- Tests return 401 status code
- Error: "Unauthorized"

**Solutions:**
1. **Check Authentication:**
   - Ensure your OpenAPI spec defines Bearer authentication
   - The system automatically adds `{{bearer_token}}` variable
   - You need to set the actual token value

2. **Set Bearer Token:**
   - Currently, you need to manually edit the Postman collection or set environment variables
   - Future enhancement: Add token configuration in UI

### 3. Tests Failing with HTTP 404 (Not Found)

**Symptoms:**
- Tests return 404 status code
- Endpoint not found

**Solutions:**
1. **Verify URL Construction:**
   - Check if base URL + path is correct
   - Ensure path parameters are properly formatted
   - Check for typos in the OpenAPI spec

2. **Check Path Parameters:**
   - Path parameters like `{id}` are converted to `:id` format
   - Make sure values are provided or set as variables

### 4. Tests Failing with HTTP 400/422 (Bad Request)

**Symptoms:**
- Tests return 400 or 422 status code
- Request validation errors

**Solutions:**
1. **Check Request Body:**
   - The system generates example request bodies from schemas
   - These may need to be customized for your API
   - Verify required fields are included

2. **Review Request Parameters:**
   - Check query parameters
   - Verify header values
   - Ensure content-type is correct

### 5. Malformed URLs

**Symptoms:**
- Tests fail with URL parsing errors
- Empty or invalid URLs

**Solutions:**
1. **Ensure Base URL is Set in OpenAPI Spec:**
   - Add `servers` section to your OpenAPI YAML/JSON
   - The system automatically extracts and uses this URL
   - Example:
     ```yaml
     servers:
       - url: https://api.example.com
         description: Production server
     ```

2. **Check URL Format:**
   - Base URL should include protocol (http:// or https://)
   - Paths in OpenAPI spec should start with `/`
   - The system automatically combines base URL + path

### 6. SSL/Certificate Errors

**Symptoms:**
- Tests fail with certificate errors
- "Hostname/IP does not match certificate's altnames" errors
- "Self-signed certificate" errors

**Solutions:**
- The system automatically disables SSL certificate verification during test execution
- This allows testing against APIs with mismatched certificates or self-signed certificates
- **Note**: SSL verification is disabled only during test execution, not for the application itself
- If you need stricter SSL validation, you can modify the test runner configuration

## Debugging Tips

### 1. Check Test Results Details

In the Test Runs view, click on a failed test to see:
- Request URL
- Request method
- Request body
- Response code
- Response body
- Error message

### 2. View Server Logs

Check the server console output for:
- Newman execution logs
- Error messages
- Request/response details

### 3. Test Manually

Before running automated tests:
1. Test the API manually using Postman or curl
2. Verify authentication works
3. Check request/response format

### 4. Validate OpenAPI Spec

Ensure your OpenAPI specification is valid:
- Use an OpenAPI validator
- Check for missing required fields
- Verify server URLs are correct

## Getting Help

If tests continue to fail:
1. Check the error message in the test results
2. Review the request/response details
3. Verify your API is accessible and working
4. Check server logs for detailed error information

