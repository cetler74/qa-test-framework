# Summary: Why Newman Tests Fail vs Postman

## The Problem in One Sentence
**Tests pass in Postman but fail in Newman because Newman runs each request in isolation when delays are enabled, breaking variable dependencies between tests.**

---

## Root Cause Analysis

### Why It Happens

1. **Collection Merging**: When multiple collections are merged, tests are flattened and prefixed with collection names
2. **Variable Deduplication**: Only the first collection's variable values are kept (first-wins policy)
3. **Delay Execution**: When `delayBetweenTests` is enabled, **each request runs as a separate Newman process**
   - This breaks variable sharing between requests
   - Auth tokens, session data, and computed values are lost
4. **Test Interdependencies**: Later tests expect data from earlier tests (e.g., auth token, created resource ID)

### The Technical Flow

**Postman (Works) - Sequential in One Session**:
```
Login Request
  ↓ Sets: pm.environment.set("token", "abc123")
Get Protected Resource (uses {{token}} = "abc123") ✓
Delete Resource (uses {{token}} = "abc123") ✓
```

**Newman With Delays (Fails) - Separate Processes**:
```
Newman Process 1: Login Request
  ↓ Sets token → Process 1 memory only

Newman Process 2: Get Protected Resource
  ↓ Token undefined (different process) ✗ FAILS

Newman Process 3: Delete Resource  
  ↓ Token undefined (different process) ✗ FAILS
```

**Newman Without Delays (Works) - One Process**:
```
Newman Process 1:
  Login Request → Sets token
  Get Protected Resource (uses token) ✓
  Delete Resource (uses token) ✓
```

---

## Three Key Issues

### Issue #1: Per-Item Delays Break Context
**Location**: `services/testRunner.js` lines 537-573

Each request runs in its **own Newman invocation**:
```javascript
for (let i = 0; i < items.length; i++) {
  const singleCollection = { item: [items[i]] };  // Only ONE item
  await runNewmanTests(singleCollection, options);  // Separate process
  await sleep(delay);  // Wait between processes
}
```

**Impact**: Variables set in request N are lost before request N+1 runs

### Issue #2: Collection Variable Conflicts
**Location**: `services/testRunner.js` lines 63-73

When merging collections:
```javascript
if (!seenVariables.has(variable.key)) {  // Only keep FIRST occurrence
  merged.variable.push(variable);
}
```

**Example**:
- Collection A: `base_url = api-prod.com`
- Collection B: `base_url = api-test.com`
- Result: All tests use `api-prod.com` ✗

### Issue #3: Item Name Prefixing
**Location**: `services/testRunner.js` lines 46-50

Items renamed during merge:
```
Original: "Retrieve SIM Swap Date"
Merged:   "SmartAPI-CAMARA R2.0.0 - Retrieve SIM Swap Date"
```

**Impact**: Test scripts referencing exact item names break

---

## The Solutions

### Quick Fix (Immediate - Disables Delays)
```javascript
// routes/api.js - don't accept or ignore delayBetweenTests
const testOptions = {
  // Remove or set to 0:
  // delayBetweenTests: 0
  envVars: req.body.envVars || {}
};
```

**Result**: ✅ Tests pass because they run in one Newman process  
**Trade-off**: ✗ Tests run concurrently (no delay between them)

### Proper Fix (Recommended - Use Newman's Native Delay)
```javascript
// services/testRunner.js - use Newman's built-in delayRequest
const newmanOptions = {
  collection: tempFile,
  reporters: ['cli'],
  delayRequest: options.delayBetweenTests ? (Number(options.delayBetweenTests) * 1000) : 0,  // ← Add this
  ...options.newmanOptions
};

// Then remove/simplify the sequential loop (lines 537-573)
// Newman runs all requests in one process with delays between them
```

**Result**: ✅ Tests pass AND delays work AND variables persist  
**Trade-off**: None - this is the correct approach

---

## How to Fix It

### Step 1: Identify Your Variables
Open your Postman collection and check:
- **Collections** → Your collection name → **Variables** tab
- Note all variable names (e.g., `base_url`, `access_token`, etc.)

### Step 2: Pass Environment Variables
When calling the test execution API:
```javascript
POST /api/test-runs/execute
{
  "projectId": 123,
  "collectionIds": [456],
  "name": "Test Run",
  "envVars": {
    "base_url": "https://api.example.com",
    "access_token": "Bearer token123",
    "environment": "test"
  },
  "delayBetweenTests": 0  // OR implement proper fix below
}
```

### Step 3: Implement Proper Fix (Optional but Recommended)
Edit `services/testRunner.js`:

**In `runNewmanTests()` function (~line 135):**
```javascript
// Add delayRequest option
const newmanOptions = {
  collection: tempFile,
  reporters: ['cli'],
  timeout: options.timeout || 60000,
  timeoutRequest: options.timeoutRequest || 30000,
  insecure: true,
  delayRequest: options.delayBetweenTests ? (Number(options.delayBetweenTests) * 1000) : 0,  // ← NEW
  ...options.newmanOptions
};
```

**In `executeTests()` function (~line 537):**
```javascript
// Simplify or remove the hasGlobalDelay branch
let newmanResults;
if (hasGlobalDelay || hasPerItemDelay) {
  // Newman's delayRequest handles delays now
  newmanResults = await runNewmanTests(mergedCollection, options);
} else {
  newmanResults = await runNewmanTests(mergedCollection, options);
}
// Can be simplified to:
let newmanResults = await runNewmanTests(mergedCollection, options);
```

---

## Key Takeaways

| Aspect | Postman | Newman (Current) | Newman (Fixed) |
|--------|---------|------------------|----------------|
| Variable Context | ✅ Shared across all requests | ❌ Lost per request | ✅ Shared in one process |
| Delays | ✅ Works without breaking tests | ❌ Breaks tests | ✅ Works with `delayRequest` |
| Interdependencies | ✅ Auth token flows work | ❌ Fail | ✅ Work |
| Collection Merging | N/A | ⚠️ Partial conflicts | ✅ Works with `envVars` |

---

## Files to Review

1. **`QUICK_FIXES.md`** - Immediate solutions and diagnostic steps
2. **`CODE_CHANGES_DELAY_FIX.md`** - Exact code changes for proper fix
3. **`NEWMAN_TROUBLESHOOTING.md`** - Detailed technical analysis
4. **`services/testRunner.js`** - Core execution logic
5. **`routes/api.js`** - API endpoint that accepts `envVars`

---

## Testing Checklist

- [ ] Check Postman collection variables
- [ ] Identify interdependent tests (auth → protected endpoint)
- [ ] Pass `envVars` when calling test execution
- [ ] Disable `delayBetweenTests` (set to 0 or omit)
- [ ] Verify tests pass
- [ ] Review test logs for "undefined variable" errors
- [ ] Implement proper delay fix if needed
- [ ] Re-enable delays with proper implementation
- [ ] Verify again

---

## Next Actions

1. **Read QUICK_FIXES.md** for immediate steps
2. **Apply Fix #1** (disable delays) and test
3. **Apply Fix #2** (add envVars) and test  
4. **When working**, optionally implement proper delay fix from CODE_CHANGES_DELAY_FIX.md

