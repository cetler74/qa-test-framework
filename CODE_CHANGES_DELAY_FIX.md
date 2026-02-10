# Code Changes for Newman Delay Fix

## Problem
Current implementation (lines 537-573 in `testRunner.js`) runs each test request as a **separate Newman process**, causing:
- Loss of variable context between tests
- Failed auth/token dependencies
- Interdependent tests failing

## Solution
Use Newman's built-in `delayRequest` option to run all requests **in one process** with delays between them.

---

## Change 1: Update `runNewmanTests()` Function

**File**: `services/testRunner.js`  
**Lines**: ~135-140 (in the `runNewmanTests` function)

### Current Code:
```javascript
    const newmanOptions = {
      collection: tempFile,
      reporters: ['cli'],
      timeout: options.timeout || 60000, // Increased to 60 seconds
      timeoutRequest: options.timeoutRequest || 30000, // Increased to 30 seconds
      insecure: true, // Allow self-signed certificates
      ...options.newmanOptions
    };
```

### Fixed Code:
```javascript
    const newmanOptions = {
      collection: tempFile,
      reporters: ['cli'],
      timeout: options.timeout || 60000, // Increased to 60 seconds
      timeoutRequest: options.timeoutRequest || 30000, // Increased to 30 seconds
      insecure: true, // Allow self-signed certificates
      // Add built-in delay between requests (in milliseconds)
      delayRequest: options.delayBetweenTests ? (Number(options.delayBetweenTests) * 1000) : 0,
      ...options.newmanOptions
    };
```

**Explanation**: 
- `delayRequest`: Tells Newman to wait N milliseconds between each request
- Multiply by 1000 to convert seconds to milliseconds
- Keeps all requests in the **same Newman process** → variables persist

---

## Change 2: Remove/Simplify the Sequential Loop

**File**: `services/testRunner.js`  
**Lines**: 537-573 (in the `executeTests` function)

### Current Code (Broken):
```javascript
    let newmanResults;
    if (hasGlobalDelay || hasPerItemDelay) {
      const combinedExecutions = [];
      const started = Date.now();

      for (let i = 0; i < (mergedCollection.item || []).length; i++) {
        const item = mergedCollection.item[i];
        const singleCollection = {
          info: mergedCollection.info || { name: testRunName },
          item: [JSON.parse(JSON.stringify(item))]
        };

        // Run single item as its own collection
        console.log(`[testRunner] Executing item ${i + 1}/${(mergedCollection.item || []).length}:`, item.name || item.request?.method || 'Unnamed');
        const parsed = await runNewmanTests(singleCollection, options);
        if (parsed && parsed.executions && parsed.executions.length > 0) {
          combinedExecutions.push(parsed.executions[0]);
        } else {
          combinedExecutions.push({
            item: { name: item.name || 'Unknown', request: item.request || {} },
            status: 'failed',
            errorMessage: 'No execution result returned'
          });
        }

        const delaySec = (typeof item._delaySeconds !== 'undefined' && item._delaySeconds !== null) ? Number(item._delaySeconds) : (Number(options.delayBetweenTests) || 0);
        console.log(`[testRunner] delaySec for item ${i + 1}:`, delaySec);
        if (delaySec > 0 && i < (mergedCollection.item || []).length - 1) {
          console.log(`[testRunner] Waiting ${delaySec} seconds before next test`);
          await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
        }
      }

      const completed = Date.now();
      newmanResults = { summary: { run: { timings: { started: started, completed: completed } } }, executions: combinedExecutions };
    } else {
      newmanResults = await runNewmanTests(mergedCollection, options);
    }
```

### Fixed Code:
```javascript
    let newmanResults;
    if (hasGlobalDelay || hasPerItemDelay) {
      // With Change #1 above, Newman handles delays internally
      // Just pass the merged collection directly
      console.log('[testRunner] Using Newman built-in delayRequest for sequential execution');
      
      // Apply per-item delays to collection items if specified
      if (hasPerItemDelay) {
        // Per-item delays are already attached to items via _delaySeconds
        // These are now interpreted differently: we need to inject them into the collection
        // For now, use global delay if per-item delays are present
        // TODO: Support per-item delays in future version using Newman's request-level delay hooks
        const globalDelay = mergedCollection.item
          .filter(item => item._delaySeconds)
          .reduce((max, item) => Math.max(max, item._delaySeconds || 0), options.delayBetweenTests || 0);
        
        if (globalDelay) {
          options.delayBetweenTests = globalDelay;
        }
      }
      
      newmanResults = await runNewmanTests(mergedCollection, options);
    } else {
      newmanResults = await runNewmanTests(mergedCollection, options);
    }
```

**Explanation**:
- Removes the sequential loop that breaks variable context
- Newman now handles all requests in one process with delays between them
- Variables persist across all requests

---

## Alternative: Simpler Quick Fix (3 lines)

If you want to test the fix quickly, just comment out the problematic code:

**File**: `services/testRunner.js`  
**Lines**: 537-573

**Option 1 - Set delayBetweenTests to 0** (Disable delays for now):
```javascript
    let newmanResults;
    // Temporarily disable delays to fix variable context issues
    const delayDisabled = true;  // ← Add this flag
    
    if ((hasGlobalDelay || hasPerItemDelay) && !delayDisabled) {  // ← Add the check
      // ... existing sequential loop code ...
    } else {
      newmanResults = await runNewmanTests(mergedCollection, options);
    }
```

**Option 2 - Just use the simpler branch**:
```javascript
    let newmanResults;
    // Always run merged collection directly; Newman handles delays internally via delayRequest option
    newmanResults = await runNewmanTests(mergedCollection, options);
```

---

## Testing the Fix

### Step 1: Apply Change #1
Update the Newman options to include `delayRequest`:
```javascript
delayRequest: options.delayBetweenTests ? (Number(options.delayBetweenTests) * 1000) : 0,
```

### Step 2: Apply Change #2 or Alternative
Simplify or remove the sequential loop.

### Step 3: Test
```bash
# Run your test API endpoint
POST /api/test-runs/execute
{
  "projectId": 1,
  "collectionIds": [1],
  "name": "Test with Delay Fix",
  "delayBetweenTests": 2,  // 2 second delay between tests
  "envVars": {
    "base_url": "https://api.example.com",
    "access_token": "Bearer token..."
  }
}
```

### Expected Results:
- ✅ Tests run in sequence
- ✅ 2-second delay between each request
- ✅ Variables persist across requests
- ✅ Auth tokens from earlier requests work in later requests

---

## Verification Checklist

After applying changes:

- [ ] Change #1: `delayRequest` option added to Newman options
- [ ] Change #2: Sequential loop removed or simplified
- [ ] No "undefined variable" errors in test results
- [ ] Tests that depend on auth tokens now pass
- [ ] Sequential tests maintain proper order
- [ ] Server still runs without errors

---

## Rollback Plan

If something goes wrong:

1. **Revert to original code**:
   ```bash
   git checkout services/testRunner.js
   ```

2. **Test with no delays** (disable in frontend):
   - Don't send `delayBetweenTests` parameter
   - Or set it to 0

3. **Original logic will run**:
   - Will still have variable issues, but tests should execute
   - Can debug further from there

---

## Why This Works

**Current Problem**:
```
Newman Process 1: Request 1 → Sets variable auth_token
Newman Process 2: Request 2 → auth_token is undefined ✗ FAILS
Newman Process 3: Request 3 → ...
```

**Fixed Behavior**:
```
Newman Process 1:
  Request 1 → Sets variable auth_token
  [Wait 2 seconds]
  Request 2 → Uses auth_token ✓ WORKS
  [Wait 2 seconds]
  Request 3 → Uses auth_token ✓ WORKS
```

Same Newman process = shared variable context = interdependent tests work

