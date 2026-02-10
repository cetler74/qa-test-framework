# Newman vs Postman Test Failures - Diagnosis & Solutions

## Problem Summary
Tests pass in Postman UI but fail when run via Newman CLI (automated). This is a common issue with test interdependencies and variable scoping.

---

## Root Causes Identified

### 1. **Collection Item Naming Conflicts** ⚠️ 
**Location**: `services/testRunner.js` lines 46-50

When multiple collections are merged, items are prefixed with collection names:
```
"SmartAPI-CAMARA R2.0.0 - Tests - SIM Swap / Retrieve SIM Swap Date"
```

**Impact**: 
- If test scripts reference items by exact name, those references break
- Pre-request scripts looking for specific test results fail
- Folder hierarchies are flattened, losing context

**Evidence**: Your test names include folders (e.g., "SIM Swap / Retrieve SIM Swap Date"), but Newman flattens these and adds prefixes.

---

### 2. **Variable Deduplication (First-Wins Policy)** ⚠️
**Location**: `services/testRunner.js` lines 63-73

```javascript
// Only the FIRST collection's variable values are kept
if (!seenVariables.has(variable.key)) {
  merged.variable.push({ ...variable });  // ← First occurrence only
  seenVariables.add(variable.key);
}
```

**Impact**:
- If merging multiple collections with variables named `access_token`, `base_url`, `environment`, etc., only the first collection's values are used
- Second/third collections use wrong variable values → tests fail with 401/403 auth errors or 404 wrong URLs

**Example**:
```
Collection A: baseUrl = "https://api-prod.example.com"
Collection B: baseUrl = "https://api-test.example.com"

Result: Collection B tests use Production URL → failures
```

---

### 3. **Test Interdependencies Lost During Merging** ⚠️
**Location**: `services/testRunner.js` lines 37-50 (item merging)

When collections are merged, folder structure is removed and items become flat:

**Postman (Works)**:
```
Folder: "Authentication"
  └─ Request: "Login"      [sets: pm.environment.set("token", ...)]
  └─ Request: "Get User"   [uses: pm.variables.get("token")]

Folder: "Data Operations"
  └─ Request: "Create Resource"
  └─ Request: "Verify Resource"
```

**Newman (Fails)**:
```
Item 1: "Collection A - Login"           [sets token]
Item 2: "Collection A - Get User"        [uses token - ✓ works]
Item 3: "Collection B - Create Resource" [NEW CONTEXT - token lost]
Item 4: "Collection B - Verify Resource" [token undefined - ✗ fails]
```

---

### 4. **Per-Item Delay Execution Loses Context** ⚠️
**Location**: `services/testRunner.js` lines 543-573

When `delayBetweenTests` or per-item delays are enabled, each request runs as a **separate Newman invocation**:

```javascript
for (let i = 0; i < (mergedCollection.item || []).length; i++) {
  const item = mergedCollection.item[i];
  const singleCollection = {
    info: mergedCollection.info,
    item: [JSON.parse(JSON.stringify(item))]  // ← Only one item
  };
  
  const parsed = await runNewmanTests(singleCollection, options);
  // Each request is independent - no shared variable context!
}
```

**Impact**:
- Variables set by POST request scripts are **not carried to the next request**
- Environment context is reset between executions
- Tests that depend on data from previous requests fail with "undefined variable" errors

**Example**:
```
Request 1: POST /auth → response.json().token = "abc123"
          pm.environment.set("token", pm.response.json().token)

Request 2: GET /data
          Authorization: Bearer {{token}}  ← token is UNDEFINED because request 2 runs in isolation
```

---

### 5. **Authentication & Session State Not Preserved** ⚠️

If your tests rely on:
- OAuth tokens set in one request used by next request
- Cookies/sessions maintained across requests  
- Login → Protected Endpoint flow

These **will fail in Newman** because each request (especially with delays) runs in isolation.

---

## Solutions

### Solution 1: Use Collection-Level Variables (Recommended) ✅

Instead of having tests set environment/local variables, **set them on the collection at upload time**.

**Before** (Fails):
```javascript
// In test script of first request
pm.environment.set("access_token", pm.response.json().token);
```

**After** (Works):
```
// In collection definition, add to collection.variable:
{
  "key": "access_token",
  "value": "Bearer token-from-env",
  "type": "string"
}
```

**Implementation in `apiSpecConverter.js`**:
```javascript
// When converting specs, inject environment-specific variables
collection.variable = [
  { key: 'base_url', value: process.env.API_BASE_URL },
  { key: 'access_token', value: process.env.API_TOKEN },
  { key: 'tenant_id', value: process.env.TENANT_ID },
  // ... etc
];
```

---

### Solution 2: Pass Environment Variables to Newman ✅

**Location**: `services/testRunner.js` around line 140

Already partially implemented! The code creates temporary environment files:

```javascript
const envObject = {
  id: envId,
  name: `Test Environment ${Date.now()}`,
  values: Object.entries(options.envVars).map(([key, value]) => ({
    key: key,
    value: String(value),
    type: 'string',
    enabled: true
  }))
};
```

**Usage**: When calling `executeTestRun()`, pass environment variables:

```javascript
await executeTestRun(projectId, collectionIds, {
  envVars: {
    access_token: 'Bearer xyz...',
    base_url: 'https://api.example.com',
    tenant_id: '123456'
  }
});
```

---

### Solution 3: Disable Collection Merging for Dependent Tests ⚠️

If tests have interdependencies, **don't merge them**. Instead:

1. Run collections **sequentially** (not merged)
2. Pass outputs from one collection to the next

**Pseudocode**:
```javascript
// Run Collection A, extract results
const resultA = await runNewmanTests(collectionA);
const tokenA = extractTokenFromResults(resultA);

// Run Collection B with token from A
await runNewmanTests(collectionB, {
  envVars: { access_token: tokenA }
});
```

---

### Solution 4: Avoid Per-Item Delays if Tests Are Dependent ⚠️

The current delay implementation runs each request in isolation, breaking variable sharing.

**Current Problem Code** (`testRunner.js` lines 537-573):
```javascript
for (let i = 0; i < items.length; i++) {
  // Each request runs in its OWN Newman process
  const singleCollection = { item: [items[i]] };
  await runNewmanTests(singleCollection);  // ✗ Loses context
  
  // Wait between requests
  await sleep(delaySeconds);
}
```

**Better Approach - Use Newman Options**:
```javascript
const newmanOptions = {
  collection: collection,
  timeout: options.timeout || 60000,
  delayRequest: options.delayBetweenTests || 0,  // ← Newman's built-in delay
  // Newman runs all items in sequence, preserving variables
};

newman.run(newmanOptions, callback);
```

**This allows Newman to run all requests sequentially in ONE process**, preserving variable context.

---

## Diagnostic Checklist

- [ ] **Check variable names**: Are you using `{{variable}}` that don't exist in collection variables?
- [ ] **Check auth**: Are auth tokens set at collection level or computed per-request?
- [ ] **Check folder order**: In Postman, do requests in the same folder depend on each other?
- [ ] **Check delays**: Are you using `delayBetweenTests`? If so, tests lose variable context.
- [ ] **Check merged collections**: When multiple collections merge, do they have conflicting variable names?
- [ ] **Check test script references**: Do test scripts reference other items by name (which becomes invalid after prefixing)?

---

## Quick Fix Steps

### For Immediate Relief:

1. **In `routes/api.js` test execution endpoint** (around line 400-450), verify the `executeTestRun()` call includes `envVars`:

```javascript
const testResults = await executeTestRun(testRun.id, collectionsToUse, {
  envVars: {
    // Add required variables here
    access_token: process.env.API_TOKEN,
    base_url: process.env.API_BASE_URL
  },
  delayBetweenTests: 0  // ← Disable delays if tests are dependent
});
```

2. **Or modify `apiSpecConverter.js`** to inject variables when converting specs:

```javascript
// Add before returning collection
collection.variable = [
  { key: 'base_url', value: 'https://api.example.com' },
  { key: 'environment', value: 'test' }
];
```

3. **Test in isolation** - run a single collection first to verify it passes:

```bash
npm run migrate
node scripts/run-sample-execution-with-delay.js  # Run sample
```

---

## References

- **Collection merging logic**: [testRunner.js](services/testRunner.js#L20-L75)
- **Newman execution**: [testRunner.js](services/testRunner.js#L95-L200)
- **Variable handling**: [testRunner.js](services/testRunner.js#L63-L73)
- **Delay execution**: [testRunner.js](services/testRunner.js#L537-L573)

---

## Next Steps

1. **Identify which variable your tests need** - check Postman collection for `{{variable}}` placeholders
2. **Inject those variables** in API route before test execution
3. **Test one collection at a time** - verify it passes before merging
4. **Gradually add complexity** - test multi-collection merging only if no interdependencies

