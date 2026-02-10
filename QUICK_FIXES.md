# Quick Fixes: Newman vs Postman Test Failures

## Summary
Your tests pass in Postman but fail in Newman due to **variable scoping**, **test interdependencies**, and **collection merging isolation**.

---

## Immediate Fixes (Do These First)

### Fix 1: Disable Per-Item Delays ⚠️ CRITICAL
**Problem**: When delays are enabled, each test runs in its own Newman process, losing variable context between tests.

**Current Issue** (lines 537-573 of `testRunner.js`):
- Each request executes separately
- Variables set in one request aren't available to the next
- Tests that depend on auth tokens or data from previous tests fail

**Solution A: Disable Delays in API Route** ✅ FASTEST
```javascript
// In routes/api.js line 510, modify the call to:
const testOptions = {
  delayBetweenTests: 0,  // ← Add this line, or don't include it
  envVars: req.body.envVars || {}
};

// Remove this block temporarily to test:
/*
if (typeof req.body.delayBetweenTests !== 'undefined') {
  const d = Number(req.body.delayBetweenTests);
  if (!isNaN(d) && d >= 0) testOptions.delayBetweenTests = d;
}
*/
```

**Solution B: Use Newman's Built-In Delay** ✅ BETTER (Fix Long-Term)
Replace the sequential single-item execution with Newman's native `delayRequest` option:

**File**: `services/testRunner.js` lines 537-573

**Current Code (Broken)**:
```javascript
if (hasGlobalDelay || hasPerItemDelay) {
  const combinedExecutions = [];
  // ... runs items one-by-one in separate Newman processes
  for (let i = 0; i < (mergedCollection.item || []).length; i++) {
    const parsed = await runNewmanTests(singleCollection, options);  // ← Each in isolation
    // ...
  }
}
```

**Fixed Code**:
```javascript
// In runNewmanTests function, around line 135-140
const newmanOptions = {
  collection: tempFile,
  reporters: ['cli'],
  timeout: options.timeout || 60000,
  timeoutRequest: options.timeoutRequest || 30000,
  insecure: true,
  delayRequest: options.delayBetweenTests ? (options.delayBetweenTests * 1000) : 0,  // ← Add this
  ...options.newmanOptions
};
```

Then **remove or simplify** the delay loop (lines 537-573).

---

### Fix 2: Inject Required Environment Variables ✅
**Problem**: Collection variables with placeholder names like `{{baseUrl}}`, `{{access_token}}` don't have values.

**Check Your Postman Collection**:
1. Open your collection in Postman
2. Click **Collections** sidebar → Your collection
3. Click **Variables** tab
4. You'll see variables like: `base_url`, `access_token`, `environment`, etc.

**Solution**: Pass these when calling execute tests

**In your frontend/client code:**
```javascript
// Before calling test execution
const response = await fetch('/api/test-runs/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    projectId: 123,
    collectionIds: [456],
    name: 'My Test Run',
    envVars: {  // ← Add this object
      base_url: 'https://api.example.com',
      access_token: 'Bearer YOUR_ACTUAL_TOKEN',
      environment: 'test',
      // Add all variables that appear in your Postman collection
    }
  })
});
```

**Or in Express route** (if calling directly):
```javascript
// In routes/api.js or elsewhere
const results = await executeTests(projectId, testRunName, {
  envVars: {
    base_url: process.env.API_BASE_URL || 'https://api.example.com',
    access_token: process.env.API_TOKEN,
    environment: process.env.NODE_ENV,
  },
  collectionIds: [collectionId]
});
```

---

### Fix 3: Test Collection Independently First ✅
**Problem**: Merging multiple collections might be causing issues.

**Solution**: Run one collection at a time to isolate the problem.

**In your tests/manual verification:**
```bash
# Using your existing test infrastructure
# 1. Create a test run with ONLY one collection
POST /api/test-runs/execute
{
  "projectId": 1,
  "collectionIds": [1],  // ← Only one collection ID
  "name": "Single Collection Test",
  "envVars": {
    "base_url": "https://api.example.com"
  }
}

# 2. Check if tests pass
# 3. If yes, add another collection one-by-one
# 4. If no, there's an issue with that specific collection
```

---

## Diagnostic Steps

### Step 1: Check for Hardcoded Values vs Variables
**In your Postman collection**, look for:
- URLs with `{{baseUrl}}` → Needs `baseUrl` in `envVars`
- Auth headers with `Bearer {{token}}` → Needs `token` in `envVars`
- Any `{{variable_name}}` → Needs value in `envVars`

**Command to find them**:
```bash
# On Windows, search in your collection file
findstr /I "{{" SmartAPI-CAMARA*.json | head -20
```

### Step 2: Look at Test Script References
**Problem**: Tests might reference other items by name, which breaks after prefixing.

**In your Postman collection**, search for test scripts that reference other items:
```javascript
// These patterns will break in Newman:
pm.sendRequest({
  url: "http://...",  // Hardcoded URL instead of variable
});

// These work in Newman:
pm.sendRequest({
  url: pm.variables.get('base_url') + "/endpoint"
});
```

### Step 3: Check for Pre-Request Dependencies
**Look for test sequences like**:
1. Login request → sets `access_token`
2. Protected API call → uses `access_token`

If this pattern exists and delays are enabled, Fix #1 will solve it.

---

## Testing Your Fixes

### Test Flow:

1. **Disable delays first** (Fix #1, Solution A):
   - Update your frontend to not send `delayBetweenTests`
   - Or set it to 0
   - Run tests again

2. **Add environment variables** (Fix #2):
   - Identify all `{{variable}}` placeholders in your collection
   - Pass actual values in `envVars` when calling execute

3. **Run one collection** (Fix #3):
   - Test with just one collection ID
   - Verify tests pass

4. **Gradually add complexity**:
   - Add second collection
   - Verify it passes
   - Then test merging behavior

---

## Expected Outcomes

### After Fix #1 (Disable Delays):
- ✅ Tests should run sequentially in ONE Newman process
- ✅ Variables persist between requests
- ✅ Interdependencies work

### After Fix #2 (Add envVars):
- ✅ Collection placeholders resolve to actual values
- ✅ Auth tokens work (if provided)
- ✅ Base URLs match the target environment

### After Fix #3 (Single Collection):
- ✅ Determines if issue is collection-specific or merging-related
- ✅ Baseline for diagnosing multi-collection failures

---

## Code Locations to Modify

| File | Lines | Issue | Fix |
|------|-------|-------|-----|
| `routes/api.js` | 490-492 | Accepts delay option | Disable or set to 0 |
| `services/testRunner.js` | 537-573 | Per-item delay loop breaks context | Use Newman's `delayRequest` option |
| `services/testRunner.js` | 135-140 | Newman options | Add `delayRequest` parameter |
| Client/Frontend | N/A | Doesn't pass `envVars` | Pass required variables |

---

## Common Variable Names in CAMARA APIs

Based on your collection names, likely needed variables:
```javascript
{
  base_url: "https://api.example.com",
  access_token: "Bearer eyJhbGc...",
  x_correlator: "b4333c46-49c0-4f62-80d7-f0ef930f1c46",
  environment: "test",
  tenant_id: "123456",
  phone_number: "+1234567890"
}
```

Check your **Postman Collection** → **Variables** tab for the exact list.

---

## Next Steps

1. ✅ **Implement Fix #1** (disable delays) → Test
2. ✅ **Implement Fix #2** (add envVars) → Test  
3. ✅ **Implement Fix #3** (single collection) → Test
4. ✅ Document working configuration
5. ✅ Re-enable delays with Solution B if needed

---

## Questions to Answer

1. **What are your collection variable names?**
   - Open Postman → Collections → Your collection → Variables
   - List the variable names

2. **Are tests dependent on each other?**
   - Do later tests use data from earlier tests?
   - Example: Login test sets token, other tests use it?

3. **What errors are you seeing?**
   - Undefined variable errors?
   - 401/403 auth errors?
   - 404 URL not found?
   - Specific assertion failures?

Answering these will help pinpoint the exact issue.

